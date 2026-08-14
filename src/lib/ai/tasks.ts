/**
 * The three things the assistant is asked to write.
 *
 * Pure, so the buttons and the route handler agree on the vocabulary.
 *
 * The distinction matters more than it looks. The main app's
 * `ai-reply-assistant` writes **customer service emails** — warm, addressed to a
 * patient, signed "AlphaMD Support". Two of the three callers here are not that:
 * a chart note is a clinical record read by other clinicians, and a handoff note
 * is a message to a colleague. Reusing the email prompt for either would produce
 * a chart note that opens by thanking the patient for reaching out.
 *
 * So the plumbing is ported and the prompts are not.
 */

export const AI_TASKS = ['chart_note', 'handoff_note', 'cs_reply'] as const

export type AiTask = (typeof AI_TASKS)[number]

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === 'string' && (AI_TASKS as readonly string[]).includes(value)
}

export const AI_TASK_LABELS: Record<AiTask, string> = {
  chart_note: 'Draft the chart note',
  handoff_note: 'Draft the handoff note',
  cs_reply: 'Draft a reply',
}

/** What the provider is told is happening, so a slow stream is not mistaken for a
 *  hang. */
export const AI_TASK_PENDING_LABELS: Record<AiTask, string> = {
  chart_note: 'Drafting…',
  handoff_note: 'Drafting…',
  cs_reply: 'Drafting…',
}
