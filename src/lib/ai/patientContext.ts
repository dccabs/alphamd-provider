import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { EMPTY_CONTEXT, type ContextRow, type PatientContext } from './patientContextFormat.ts'

/**
 * Assembling the patient context the assistant reads, ported from the main app's
 * `ai-reply-assistant`.
 *
 * One deliberate change from the original: **every query is independently
 * fault-tolerant.** The original wrapped all seven in a single try/catch, so one
 * failing table silently emptied the whole context and the model drafted from
 * nothing while looking like it had everything. Here a failure drops one section
 * and the rest still reaches the model, because a draft missing the invoice list
 * is worth far more than a draft missing the labs.
 *
 * The rendering half lives in `patientContextFormat.ts` so it can be tested
 * without a database.
 */

async function rows(
  table: string,
  build: (query: ReturnType<ReturnType<typeof createAdminClient>['from']>) => unknown
): Promise<ContextRow[]> {
  try {
    const admin = createAdminClient()
    const { data, error } = (await build(admin.from(table))) as {
      data: ContextRow[] | null
      error: { message: string } | null
    }
    if (error) {
      console.error(`[ai/patientContext] ${table} failed: ${error.message}`)
      return []
    }
    return data ?? []
  } catch (error) {
    console.error(`[ai/patientContext] ${table} threw:`, error)
    return []
  }
}

export async function fetchPatientContext(
  patientId: string,
  reportId: string | null
): Promise<PatientContext> {
  const [
    patientRows,
    messages,
    notes,
    subscriptions,
    transactions,
    invoices,
    labRequisitions,
    reportRows,
  ] = await Promise.all([
    rows('user_list', (q) =>
      q
        .select('full_name, first_name, last_name, email, state, registration_status')
        .eq('user_id', patientId)
        .limit(1)
    ),
    rows('zendesk_last_contact', (q) =>
      q
        .select('message, created_at, is_staff, is_public')
        .eq('user_id', patientId)
        .order('created_at', { ascending: false })
        .limit(20)
    ),
    rows('patient_notes_private', (q) =>
      q
        .select('note, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(10)
    ),
    rows('amd_subscriptions', (q) =>
      q
        .select('title, status, total, billing_day, start_date, last_successful_charge')
        .eq('user_id', patientId)
        .eq('status', 'active')
    ),
    rows('transactions_v4', (q) =>
      q
        .select('transactionStatus, settleAmount, submitTimeUTC, transactionType')
        .eq('user_id', patientId)
        .order('created_at', { ascending: false })
        .limit(5)
    ),
    rows('amd_invoices', (q) =>
      q
        .select('subscription_title, total, paid, paid_date, created_at')
        .eq('user_id', patientId)
        .order('created_at', { ascending: false })
        .limit(5)
    ),
    rows('lab_requisitions', (q) =>
      q
        .select('requests, diagnosis_code, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(5)
    ),
    reportId
      ? rows('lab_review_reports', (q) => q.select('patient_summary').eq('id', reportId).limit(1))
      : Promise.resolve([] as ContextRow[]),
  ])

  return {
    ...EMPTY_CONTEXT,
    patient: patientRows[0] ?? null,
    labSummary: (reportRows[0]?.patient_summary as string | undefined) ?? null,
    messages,
    notes,
    subscriptions,
    transactions,
    invoices,
    labRequisitions,
  }
}

export { formatPatientContext } from './patientContextFormat.ts'
export type { PatientContext } from './patientContextFormat.ts'
