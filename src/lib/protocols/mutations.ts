import 'server-only'

import type { ProviderAccess } from '@/lib/authz'
import { FLAG, PATIENT_STATUS } from '@/lib/labReviews/clinicalIds'
import { logLabReviewEvent, resolveActor } from '@/lib/labReviews/events'
import type { DraftMedication } from '@/lib/labReviews/reviewDraft'
import { addPatientFlag } from '@/lib/patients/flags'
import { greetingName } from '@/lib/patientName'
import { sendPauboxEmail } from '@/lib/paubox'
import { createAdminClient } from '@/lib/supabase/admin'
import { pricingBreakdown } from './breakdown'
import { requireConsents, sendConsentEmail } from './consents'
import { loadPricingCatalog } from './loadCatalog'
import { formatUsd, type Cents } from './money'
import { PROTOCOL_FROM, protocolEmail } from './protocolEmail'
import { renderProtocolEmailHtml } from './protocolEmailHtml'
import {
  DISCOUNT_NOTICE,
  blockLine,
  planProtocol,
  type PricingBlock,
  type ProtocolPlan,
  type ProtocolQuote,
} from './protocolPlan'
import { pricingSnapshotHref, protocolData, snapshotRow } from './snapshot'

/**
 * Sending a recommended protocol, and everything that follows from it.
 *
 * This is the most consequential write in the portal. It quotes a patient a
 * price, emails it to them, and puts them in a state where a cron will chase them
 * about it. So the shape mirrors `consultations/mutations.ts` — a preflight that
 * refuses while the provider can still act, then an ordered send whose failures
 * are reported rather than thrown — and the order is chosen so that no failure
 * leaves the patient holding a price nobody can explain.
 *
 * The order, and why:
 *
 *  1. **Price it.** Pure, no writes. A protocol that cannot be priced stops here
 *     and becomes a note for staff, which is a normal outcome and not a failure.
 *  2. **Record the quote**, snapshot then protocol. These two are one fact split
 *     across two tables, so a protocol that fails to insert takes its snapshot
 *     back out with it — see `discardSnapshot`.
 *  3. **Email it.** After the record, so an email always refers to something that
 *     exists. If the send fails the quote is still on file and the patient can
 *     still find it by logging in, which is why this is reported rather than
 *     rolled back.
 *  4. **Everything else** — the chart note, the status or flag, the consents.
 *     Each independent, each failure its own warning, because by now the patient
 *     has been quoted and undoing that is not on the table.
 *
 * What this deliberately does *not* do is roll the review back. By the time it
 * runs the review is already finished; see `completeLabReview`.
 */

export type ProtocolSendResult =
  | { kind: 'sent'; snapshotId: string; total: Cents; warnings: string[] }
  /** Priced by hand instead. The reasons belong on the chart, not in an error. */
  | { kind: 'handed-off'; blocks: PricingBlock[] }
  | { kind: 'nothing-to-send' }
  | { kind: 'failed'; error: string }

type Subject = {
  firstName: string | null
  email: string | null
  statusId: number | null
}

async function subjectFor(patientId: string): Promise<Subject> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('user_list')
    .select('first_name, last_name, preferred_name, email, status')
    .eq('user_id', patientId)
    .maybeSingle()
  if (error) throw new Error(`user_list lookup failed: ${error.message}`)

  return {
    firstName: greetingName({
      preferredName: data?.preferred_name as string | null,
      firstName: data?.first_name as string | null,
      lastName: data?.last_name as string | null,
    }),
    email: (data?.email as string | null)?.trim() || null,
    statusId: data?.status === null || data?.status === undefined ? null : Number(data.status),
  }
}

/**
 * Price the medications a review added.
 *
 * The one place the catalog is read. Callers hold the resulting plan and pass it
 * to everything below, rather than each re-planning from the medications: a
 * completion asks what the protocol comes to three times — to preflight it, to
 * write the note, and to send it — and three independent plans could disagree
 * with each other across a catalog edit, which would put one price on the chart
 * and a different one in the patient's inbox.
 */
export async function planProtocolFor(medications: DraftMedication[]): Promise<ProtocolPlan> {
  if (medications.every((med) => !med.name.trim())) return { kind: 'none' }

  return planProtocol(await loadPricingCatalog(), medications)
}

/**
 * Whether a protocol could be sent for this patient, without sending it.
 *
 * The counterpart of `labOrderProblems` and `consultProblems`, and there for the
 * same reason: `sendProtocol` runs after the review has been marked finished, so
 * a refusal there can only be a warning about a quote that never went out.
 *
 * Only one thing is checked, and only when a quote will actually be produced: an
 * address to send it to. A protocol that is going to staff to price needs no
 * email, and refusing to finish a review over one would be refusing over
 * something this path was never going to use.
 */
export async function protocolProblems(
  patientId: string,
  plan: ProtocolPlan
): Promise<string[]> {
  if (plan.kind !== 'quote') return []

  const subject = await subjectFor(patientId)
  if (!subject.email) {
    return [
      'This patient has no email address on file, so the recommended protocol cannot be sent. Add one, or remove the medication.',
    ]
  }

  return []
}

export async function sendProtocol(
  access: ProviderAccess,
  reviewId: string,
  patientId: string,
  plan: ProtocolPlan,
  medications: DraftMedication[]
): Promise<ProtocolSendResult> {
  if (plan.kind === 'none') return { kind: 'nothing-to-send' }
  if (plan.kind === 'blocked') return { kind: 'handed-off', blocks: plan.blocks }

  const { quote } = plan
  const subject = await subjectFor(patientId)
  if (!subject.email) {
    return {
      kind: 'failed',
      error: 'the patient has no email address on file, so no protocol was sent',
    }
  }

  const admin = createAdminClient()

  // `pricing_version` is in the row object and in `data.source`, but the
  // production column is added by `migrations/2026-08-17-protocol-send.sql`,
  // which has not been applied. Writing it here would refuse the snapshot.
  const { pricing_version: _pricingVersion, ...snapshotInsert } = snapshotRow(quote, {
    createdBy: access.userId,
  })

  const { data: snapshot, error: snapshotError } = await admin
    .from('pricing_snapshots')
    .insert(snapshotInsert)
    .select('id')
    .maybeSingle()
  if (snapshotError || !snapshot?.id) {
    return {
      kind: 'failed',
      error: `the quote could not be saved (${snapshotError?.message ?? 'no row returned'}), so no protocol was sent`,
    }
  }

  const snapshotId = snapshot.id as string

  const { data: protocol, error: protocolError } = await admin
    .from('medication_protocols')
    .insert({
      patient_id: patientId,
      created_by: access.userId,
      last_updated_by: access.userId,
      snapshot_id: snapshotId,
      // `lab_review_id` waits on the same unapplied migration; the review is
      // recorded on `data.source.labReview` until that column exists.
      data: protocolData(quote, { snapshotId, labReviewId: reviewId }),
      // `approved_by_pt` and `signed_payment_agreement` are left to their
      // defaults of false, which is what "sent, awaiting the patient" is. The
      // patient's own acceptance path flips both.
    })
    .select('id')
    .maybeSingle()
  if (protocolError || !protocol?.id) {
    await discardSnapshot(snapshotId)
    return {
      kind: 'failed',
      error: `the protocol could not be saved (${protocolError?.message ?? 'no row returned'}), so nothing was sent`,
    }
  }

  const email = protocolEmail({ firstName: subject.firstName, quote })
  const sent = await sendPauboxEmail({
    from: PROTOCOL_FROM,
    to: subject.email,
    subject: email.subject,
    text: email.text,
    html: await renderProtocolEmailHtml(email, subject.firstName),
  })

  const warnings: string[] = []

  if (!sent.ok) {
    // Not rolled back. The quote is on file, the patient can see it when they log
    // in, and the main app's follow-up cron will chase them with a link to it —
    // so the useful thing is to say the email specifically did not arrive.
    warnings.push(
      `the protocol was created but the email was not sent (${sent.error}); the patient does not know about it yet`
    )
  }

  warnings.push(
    ...(await afterSend(access, patientId, quote, {
      snapshotId,
      sentTo: sent.ok ? subject.email : null,
      statusId: subject.statusId,
      medicationIds: medications
        .map((med) => med.medicationId)
        .filter((id): id is number => id !== null),
    }))
  )

  const actor = await resolveActor(access)
  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'protocol_sent',
    actor,
    summary: `Sent a recommended protocol for ${formatUsd(quote.grandTotal)}`,
    metadata: {
      snapshotId,
      protocolId: protocol.id,
      total: formatUsd(quote.grandTotal),
      productId: quote.subscription?.productId ?? null,
      sentTo: sent.ok ? subject.email : null,
    },
  })
  if (!logged.ok) warnings.push(`the protocol is not in the review's history (${logged.error})`)

  return { kind: 'sent', snapshotId, total: quote.grandTotal, warnings }
}

/**
 * Take a snapshot back out when the protocol beside it could not be written.
 *
 * The nearest thing to a transaction available across two PostgREST inserts. It
 * matters because a snapshot with no protocol is a price nothing points at: no
 * patient page reads it, so it would sit there indefinitely looking like a quote
 * somebody was sent. Failing to delete it is not worth reporting to the provider —
 * an orphan row is harmless — so this only logs.
 */
async function discardSnapshot(snapshotId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('pricing_snapshots')
    .delete()
    .eq('id', snapshotId)
  if (error) {
    console.error(`[protocols] orphaned pricing snapshot ${snapshotId}: ${error.message}`)
  }
}

/**
 * The chart note, the patient's state, and the consents.
 *
 * Each attempted independently and each failure reported, never thrown — the
 * patient has a price in their inbox by now, and aborting would leave the caller
 * thinking nothing happened.
 */
async function afterSend(
  access: ProviderAccess,
  patientId: string,
  quote: ProtocolQuote,
  context: {
    snapshotId: string
    sentTo: string | null
    statusId: number | null
    medicationIds: number[]
  }
): Promise<string[]> {
  const admin = createAdminClient()
  const warnings: string[] = []

  const { error: noteError } = await admin.from('patient_notes_private').insert({
    patient_id: patientId,
    created_by: access.userId,
    note: chartNote(quote, context),
  })
  if (noteError) warnings.push('the protocol is not on the chart')

  // An active subscriber is flagged rather than restatused: "Pricing sent to PT"
  // is a *non-patient* status, and moving somebody onto it would read as having
  // lost their subscription. It is also what the follow-up cron scans for, and a
  // paying patient must not be chased as an unconverted lead.
  if (context.statusId === PATIENT_STATUS.activeSubscription) {
    const flagged = await addPatientFlag(patientId, FLAG.newPricingSent, access.userId)
    if (!flagged) warnings.push('the "New Pricing / Protocol Sent" flag could not be added')
  } else {
    const { error } = await admin
      .from('user_list')
      .update({ status: PATIENT_STATUS.pricingSentToPatient })
      .eq('user_id', patientId)
    if (error) warnings.push("the patient's status could not be set to \"Pricing sent to PT\"")
  }

  try {
    await requireConsents(patientId, context.medicationIds, {
      requiredBy: access.userId,
      reason: 'Recommended protocol sent from a lab review',
    })
  } catch (error) {
    warnings.push(
      `the required consents were not recorded (${error instanceof Error ? error.message : 'unknown error'})`
    )
  }

  try {
    const result = await sendConsentEmail(patientId, { sentBy: access.userId })
    if (!result.sent && result.reason === 'failed') {
      warnings.push(`the consent email was not sent (${result.error})`)
    }
    if (!result.sent && result.reason === 'no-email') {
      warnings.push('the consent email had no address to go to')
    }
    // `nothing-unsigned` and `recently-sent` are both correct outcomes.
  } catch (error) {
    warnings.push(
      `the consent email was not sent (${error instanceof Error ? error.message : 'unknown error'})`
    )
  }

  return warnings
}

/**
 * What the chart records about a protocol.
 *
 * Plain text, like every other note this app writes. Two things are on it that
 * the patient's copy does not carry: a link to the stored quote, which is how
 * staff answer "what exactly were they shown", and the fact that no discount was
 * applied, which is the one way this quote is predictably wrong.
 */
function chartNote(
  quote: ProtocolQuote,
  context: { snapshotId: string; sentTo: string | null }
): string {
  return [
    context.sentTo
      ? `Recommended protocol sent to ${context.sentTo}.`
      : 'Recommended protocol created, but the email to the patient failed. They have not been told.',
    quote.medications
      .map((med) => (med.instructions ? `• ${med.name}: ${med.instructions}` : `• ${med.name}`))
      .join('\n'),
    ['PRICING BREAKDOWN:', ...pricingBreakdown(quote)].join('\n'),
    `Total Due Today: ${formatUsd(quote.grandTotal)}`,
    DISCOUNT_NOTICE,
    `Pricing snapshot: ${pricingSnapshotHref(context.snapshotId)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Why a protocol went to staff instead, as lines for the chart and for customer
 *  service. Re-exported so callers do not have to reach into `protocolPlan`. */
export function handoffLines(blocks: PricingBlock[]): string[] {
  return blocks.map(blockLine)
}
