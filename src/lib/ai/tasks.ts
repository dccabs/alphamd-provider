/**
 * The two things the assistant is asked to write from a patient's history.
 *
 * Pure, so the buttons and the route handler agree on the vocabulary.
 *
 * The distinction from the main app matters more than it looks. Its
 * `ai-reply-assistant` writes **customer service emails** — warm, addressed to a
 * patient, signed "AlphaMD Support". A handoff note is not that: it is a message
 * to a colleague, and reusing the email prompt for it produces a handoff that
 * opens by thanking the patient for reaching out.
 *
 * So the plumbing is ported and the prompts are not.
 *
 * The chart note used to be a third task here, drafted from the patient's
 * history. It is now one of the review fields in `reviewFields.ts`, written from
 * the provider's own words and nothing else.
 */

export const AI_TASKS = ['handoff_note', 'cs_reply'] as const

export type AiTask = (typeof AI_TASKS)[number]

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === 'string' && (AI_TASKS as readonly string[]).includes(value)
}

export const AI_TASK_LABELS: Record<AiTask, string> = {
  handoff_note: 'Draft the handoff note',
  cs_reply: 'Draft a reply',
}

/** What the provider is told is happening, so a slow stream is not mistaken for a
 *  hang. */
export const AI_TASK_PENDING_LABELS: Record<AiTask, string> = {
  handoff_note: 'Drafting…',
  cs_reply: 'Drafting…',
}
