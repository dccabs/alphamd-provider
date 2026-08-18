import 'server-only'

import { greetingName } from '@/lib/patientName'
import { sendPauboxEmail } from '@/lib/paubox'
import { createAdminClient } from '@/lib/supabase/admin'
import { RESTRICTED_MEDICATION_IDS } from '@/lib/labReviews/clinicalIds'

/**
 * The consents a recommended protocol makes due.
 *
 * Ported from the admin app's `POST /api/consents/add-required`,
 * `GET /api/consents/unsigned` and `POST /api/consents/send-email`, which the
 * pricing modal calls in that order after it sends a quote. Ported rather than
 * called: this app talks to the same database, and going through the other app's
 * HTTP layer would mean holding a session for a server-to-server call that has
 * no user in it.
 *
 * Two things are worth knowing before changing anything here:
 *
 *  - **A consent is required per *type*, not per medication.** Several
 *    medications can map to one consent type, and the patient signs it once.
 *    Every query below deduplicates by `consent_type_id` for that reason.
 *  - **The general consent is always required**, whatever was prescribed.
 *
 * Nothing here blocks a protocol. A patient who ends up with a quote and no
 * consent record can still be sent one by hand, and refusing to send a price
 * because a consent row failed to insert would be the wrong trade.
 */

/** What was added, so the caller can say so on the chart. */
export type RequiredConsents = { addedTypeIds: number[]; alreadyRequired: number[] }

/**
 * Make the consents for these medications due, skipping any already on file.
 *
 * Restricted medications are filtered out first, matching the admin app: they
 * cannot be prescribed at all, so a consent for one would be a record of
 * something that never happened.
 */
export async function requireConsents(
  patientId: string,
  medicationIds: number[],
  options: { requiredBy: string; reason: string }
): Promise<RequiredConsents> {
  const admin = createAdminClient()

  const allowed = medicationIds.filter((id) => !RESTRICTED_MEDICATION_IDS.includes(id))

  const wanted = new Set<number>()

  if (allowed.length) {
    const { data, error } = await admin
      .from('medication_consent_templates')
      .select('consent_type_id')
      .eq('is_active', true)
      .in('medication_id', allowed)
    if (error) throw new Error(`medication_consent_templates lookup failed: ${error.message}`)

    for (const row of data ?? []) wanted.add(Number(row.consent_type_id))
  }

  // Always due, whatever the protocol contains.
  const { data: general, error: generalError } = await admin
    .from('consent_types')
    .select('id')
    .eq('name', 'general')
    .maybeSingle()
  if (generalError) throw new Error(`consent_types lookup failed: ${generalError.message}`)
  if (general?.id) wanted.add(Number(general.id))

  if (wanted.size === 0) return { addedTypeIds: [], alreadyRequired: [] }

  const { data: existing, error: existingError } = await admin
    .from('patient_required_consents')
    .select('consent_type_id')
    .eq('patient_id', patientId)
    .eq('is_active', true)
  if (existingError) {
    throw new Error(`patient_required_consents lookup failed: ${existingError.message}`)
  }

  const already = new Set((existing ?? []).map((row) => Number(row.consent_type_id)))
  const toAdd = [...wanted].filter((id) => !already.has(id))

  if (toAdd.length === 0) {
    return { addedTypeIds: [], alreadyRequired: [...wanted] }
  }

  const { error } = await admin.from('patient_required_consents').insert(
    toAdd.map((consentTypeId) => ({
      patient_id: patientId,
      consent_type_id: consentTypeId,
      required_by: options.requiredBy,
      reason: options.reason,
      is_active: true,
    }))
  )
  if (error) throw new Error(`patient_required_consents insert failed: ${error.message}`)

  return {
    addedTypeIds: toAdd,
    alreadyRequired: [...wanted].filter((id) => already.has(id)),
  }
}

export type UnsignedConsent = { templateId: number; consentTypeId: number; displayName: string }

/**
 * The consents this patient still owes a signature for.
 *
 * Two sources, as in the admin app: the types a protocol made due, and the
 * medications they are actually prescribed — the second catches a medication added
 * straight onto the chart without a protocol ever being sent.
 *
 * Deduplicated by consent type, because a type can have several templates behind
 * it and the patient signs the type once. A signature against *either* the
 * template or the type counts, which is how a patient who signed an older version
 * of a document is not asked again.
 */
export async function unsignedConsents(patientId: string): Promise<UnsignedConsent[]> {
  const admin = createAdminClient()

  const [required, prescribed] = await Promise.all([
    admin
      .from('patient_required_consents')
      .select('consent_type_id')
      .eq('patient_id', patientId)
      .eq('is_active', true),
    admin.from('patient_medications').select('medication_id').eq('user_id', patientId),
  ])
  if (required.error) throw new Error(`required consents failed: ${required.error.message}`)
  if (prescribed.error) throw new Error(`patient_medications failed: ${prescribed.error.message}`)

  const typeIds = (required.data ?? []).map((row) => Number(row.consent_type_id))
  const medicationIds = (prescribed.data ?? [])
    .map((row) => Number(row.medication_id))
    .filter((id) => Number.isFinite(id))

  const SELECT = 'id, consent_type_id, consent_types!inner(display_name)'
  type TemplateRow = {
    id: number
    consent_type_id: number
    consent_types: { display_name: string } | { display_name: string }[]
  }

  const [byType, byMedication] = await Promise.all([
    typeIds.length
      ? admin
          .from('medication_consent_templates')
          .select(SELECT)
          .eq('is_active', true)
          .in('consent_type_id', typeIds)
          .returns<TemplateRow[]>()
      : { data: [] as TemplateRow[], error: null },
    medicationIds.length
      ? admin
          .from('medication_consent_templates')
          .select(SELECT)
          .eq('is_active', true)
          .in('medication_id', medicationIds)
          // A `smart_phrase` row is chart text, not a document to sign.
          .in('template_type', ['consent', 'both'])
          .returns<TemplateRow[]>()
      : { data: [] as TemplateRow[], error: null },
  ])
  if (byType.error) throw new Error(`consent templates failed: ${byType.error.message}`)
  if (byMedication.error) throw new Error(`consent templates failed: ${byMedication.error.message}`)

  const { data: signed, error: signedError } = await admin
    .from('patient_consent_signatures')
    .select('consent_template_id, consent_type_id')
    .eq('patient_id', patientId)
    .eq('is_valid', true)
  if (signedError) throw new Error(`consent signatures failed: ${signedError.message}`)

  const signedTemplates = new Set((signed ?? []).map((row) => Number(row.consent_template_id)))
  const signedTypes = new Set((signed ?? []).map((row) => Number(row.consent_type_id)))

  const seen = new Set<number>()
  const unsigned: UnsignedConsent[] = []

  for (const row of [...(byType.data ?? []), ...(byMedication.data ?? [])]) {
    const templateId = Number(row.id)
    const consentTypeId = Number(row.consent_type_id)

    if (signedTemplates.has(templateId) || signedTypes.has(consentTypeId)) continue
    if (seen.has(consentTypeId)) continue
    seen.add(consentTypeId)

    // PostgREST returns an embedded row as an object, but types it either way.
    const type = Array.isArray(row.consent_types) ? row.consent_types[0] : row.consent_types

    unsigned.push({ templateId, consentTypeId, displayName: type?.display_name ?? 'Consent form' })
  }

  return unsigned
}

const CONSENT_SUBJECT = 'Action Required: Informed Consent for Your Treatment'
const CONSENT_FROM = 'AlphaMD <contact@alphamd.org>'

export type ConsentEmailResult =
  | { sent: true }
  /** Not an error: nothing to sign, or one went out within the day. */
  | { sent: false; reason: 'nothing-unsigned' | 'recently-sent' | 'no-email' }
  | { sent: false; reason: 'failed'; error: string }

/**
 * Ask the patient to sign what they owe.
 *
 * A **separate email** from the protocol quote, which is how the admin app does it
 * and worth keeping: the two have different subjects, land in different places in
 * a patient's head, and one being rejected must not take the other with it.
 *
 * The 24-hour guard is ported as-is. It is keyed on the patient rather than on the
 * documents, so a second protocol sent the same afternoon does not produce a
 * second consent email — which is the intent, since the link goes to a page
 * listing everything outstanding rather than to a specific form.
 */
export async function sendConsentEmail(
  patientId: string,
  options: { sentBy: string }
): Promise<ConsentEmailResult> {
  const admin = createAdminClient()

  const unsigned = await unsignedConsents(patientId)
  if (unsigned.length === 0) return { sent: false, reason: 'nothing-unsigned' }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await admin
    .from('consent_email_log')
    .select('id')
    .eq('patient_id', patientId)
    .gte('email_sent_at', since)
    .limit(1)
  if (recent?.length) return { sent: false, reason: 'recently-sent' }

  const { data: patient, error } = await admin
    .from('user_list')
    .select('first_name, last_name, preferred_name, email')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  const email = (patient?.email as string | null)?.trim()
  if (!email) return { sent: false, reason: 'no-email' }

  const firstName =
    greetingName({
      preferredName: patient?.preferred_name as string | null,
      firstName: patient?.first_name as string | null,
      lastName: patient?.last_name as string | null,
    }) ?? 'there'

  const sent = await sendPauboxEmail({
    from: CONSENT_FROM,
    to: email,
    subject: CONSENT_SUBJECT,
    text: consentEmailBody(firstName, unsigned),
  })
  if (!sent.ok) return { sent: false, reason: 'failed', error: sent.error }

  const { error: logError } = await admin.from('consent_email_log').insert({
    patient_id: patientId,
    consent_template_ids: unsigned.map((consent) => consent.templateId),
    sent_by: options.sentBy,
    email_sent_at: new Date().toISOString(),
    // The admin app's value for "sent automatically by the pricing tool", kept so
    // the two apps' sends are countable together.
    email_type: 'auto_from_pos',
  })
  if (logError) {
    // Logged and swallowed, as upstream does: the patient has the email, and
    // failing here would only cause a duplicate on a retry.
    console.error('[consents] could not log the consent email:', logError.message)
  }

  return { sent: true }
}

/** Word for word the admin app's body, so a patient who has had one before sees
 *  the same request. Plain text only — there is no HTML part upstream either. */
function consentEmailBody(firstName: string, unsigned: UnsignedConsent[]): string {
  const base = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.org'
  const list = unsigned.map((consent) => `- ${consent.displayName}`).join('\n')

  return `Hi ${firstName},

Your provider has recommended a treatment protocol that requires your informed consent.

Please review and sign the following consent documents:
${list}

Sign your consent forms here: ${base.replace(/\/$/, '')}/profile/documents

These consent forms are required before we can proceed with your treatment. The signature process is quick and can be completed electronically through our secure patient portal.

If you have any questions about the consent forms or your treatment, please don't hesitate to contact us.

Best regards,
The AlphaMD Team

---
This email was sent by AlphaMD. If you have questions, please contact us at contact@alphamd.org
© ${new Date().getFullYear()} AlphaMD. All rights reserved.`
}
