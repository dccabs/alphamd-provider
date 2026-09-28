/**
 * The question, restated for the patient, in a new-ticket answer.
 *
 * The question on a Provider Question is written by staff, for a provider: it
 * can carry workflow, instructions or anything else a patient should not read.
 * So it is never pasted into the patient's ticket. A model restates only what
 * the patient asked, as a sentence addressed to them, or says there is nothing
 * to restate — in which case the letter acknowledges the question without it.
 *
 * Only the question text is sent. The CS comments are internal by definition
 * and stay out of the prompt entirely.
 */

export const QUESTION_RECAP_MODEL = 'gpt-6-sol'

/** Longer than this is not a recap; refusing beats sending a paragraph. */
const MAX_RECAP_CHARS = 300

const SYSTEM = [
  "You restate a patient's question for a message the patient will receive from their clinic.",
  'The text you are given was written by clinic staff for a provider. It may include internal instructions, workflow, staff names or system details. Leave all of that out.',
  'Write one or two short, plain sentences addressed to the patient, beginning "You asked", describing only what the patient wants to know.',
  'Do not answer the question, give medical advice, or add anything that is not in the text.',
  'If the text does not contain a question or request from the patient, reply with exactly NONE.',
].join('\n')

export function questionRecapPrompt(question: string): { system: string; user: string } {
  return { system: SYSTEM, user: `Text:\n${question.trim()}` }
}

/** The model's reply, made safe to send: one paragraph, no wrapping quotes, or '' for none. */
export function parseQuestionRecap(raw: string): string {
  const text = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .trim()
  if (!text || /^none\.?$/i.test(text)) return ''
  if (text.length > MAX_RECAP_CHARS) return ''
  return text
}
