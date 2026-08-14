/**
 * Rendering the assistant's patient context as Markdown.
 *
 * Split from the fetching half so it is pure and testable: `patientContext.ts`
 * imports 'server-only' and the service-role client, neither of which belongs in
 * a unit test.
 *
 * Truncation limits are carried over from the main app's `ai-reply-assistant`.
 * They exist to bound the prompt and the numbers were tuned against real tickets,
 * so they are not re-litigated here.
 */

export type ContextRow = Record<string, unknown>

export type PatientContext = {
  patient: ContextRow | null
  /** The lab review's AI summary. Absent from the ported original, which was
   *  built for customer service and had no reason to know what the labs said. */
  labSummary: string | null
  messages: ContextRow[]
  notes: ContextRow[]
  subscriptions: ContextRow[]
  transactions: ContextRow[]
  invoices: ContextRow[]
  labRequisitions: ContextRow[]
}

export const EMPTY_CONTEXT: PatientContext = {
  patient: null,
  labSummary: null,
  messages: [],
  notes: [],
  subscriptions: [],
  transactions: [],
  invoices: [],
  labRequisitions: [],
}

function shortDate(value: unknown): string {
  if (typeof value !== 'string') return 'Unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return date.toISOString().slice(0, 10)
}

function clamp(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : ''
  if (!text) return 'No content'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

/**
 * Sections with nothing in them are omitted entirely rather than rendered as
 * "none". An empty heading reads to the model as a fact about the patient — "no
 * active subscriptions" — when it may only mean that one query failed.
 */
export function formatPatientContext(context: PatientContext): string {
  const parts: string[] = ['# Patient context']

  if (context.patient) {
    const p = context.patient
    parts.push(
      [
        '## Patient',
        `- Name: ${[p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'N/A'}`,
        `- Email: ${p.email ?? 'N/A'}`,
        `- State: ${p.state ?? 'N/A'}`,
        `- Registration status: ${p.registration_status ?? 'N/A'}`,
      ].join('\n')
    )
  }

  if (context.labSummary) {
    parts.push(`## Lab review summary\n${clamp(context.labSummary, 6000)}`)
  }

  if (context.messages.length) {
    // Reversed into chronological order: a conversation read newest-first invites
    // the model to answer the wrong message.
    const chronological = [...context.messages].reverse()
    parts.push(
      `## Message history (${context.messages.length})\n` +
        chronological
          .map((m) => {
            const who = m.is_staff ? '[ALPHAMD STAFF]' : '[PATIENT]'
            const visibility = m.is_public === false ? ' (internal)' : ''
            return `### ${who}${visibility} — ${shortDate(m.created_at)}\n${clamp(m.message, 500)}`
          })
          .join('\n\n')
    )
  }

  if (context.notes.length) {
    parts.push(
      `## Staff notes (${context.notes.length})\n` +
        context.notes
          .map((n) => `### ${shortDate(n.created_at)}\n${clamp(n.note, 300)}`)
          .join('\n\n')
    )
  }

  if (context.subscriptions.length) {
    parts.push(
      '## Active subscriptions\n' +
        context.subscriptions
          .map((s) => {
            const charge = s.last_successful_charge
              ? `, last charge ${shortDate(s.last_successful_charge)}`
              : ''
            return `- ${s.title}: $${s.total}/month, billing day ${s.billing_day}${charge}`
          })
          .join('\n')
    )
  }

  if (context.transactions.length) {
    parts.push(
      '## Recent transactions\n' +
        context.transactions
          .map(
            (t) =>
              `- ${shortDate(t.submitTimeUTC)}: $${t.settleAmount ?? 'N/A'} — ${
                t.transactionStatus
              } (${t.transactionType})`
          )
          .join('\n')
    )
  }

  if (context.invoices.length) {
    parts.push(
      '## Recent invoices\n' +
        context.invoices
          .map(
            (i) =>
              `- ${shortDate(i.created_at)}: ${i.subscription_title} — $${i.total} (${
                i.paid ? 'Paid' : 'Unpaid'
              })`
          )
          .join('\n')
    )
  }

  if (context.labRequisitions.length) {
    parts.push(
      '## Lab requisitions\n' +
        context.labRequisitions
          .map((l) => `- ${shortDate(l.created_at)}: ${testNames(l)}`)
          .join('\n')
    )
  }

  return parts.join('\n\n')
}

/** `requests` is jsonb that has been written both as an array and as a JSON
 *  string over the years, so both are handled and neither is allowed to throw. */
function testNames(requisition: ContextRow): string {
  const raw = requisition.requests
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) {
      const names = parsed
        .map((r) => (typeof r === 'string' ? r : (r as ContextRow)?.name))
        .filter(Boolean)
      if (names.length) return names.join(', ')
    }
  } catch {
    // Unparseable payload — the date alone is still worth showing.
  }
  return 'requisition created'
}
