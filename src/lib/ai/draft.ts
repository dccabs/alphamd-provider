import 'server-only'

import OpenAI from 'openai'

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPatientContext, formatPatientContext } from './patientContext.ts'
import {
  systemPromptFor,
  systemPromptForField,
  userPromptFor,
  userPromptForField,
} from './prompts.ts'
import type { ReviewField } from './reviewFields.ts'
import type { AiTask } from './tasks.ts'
import type { ReplyIdentity } from '@/lib/labReviews/replyIdentity'

/**
 * The assistant's server half: resolve the patient from the review, assemble
 * context, and stream plain text back.
 *
 * Two entry points, and the difference between them is the point. `streamDraft`
 * writes from the patient's history. `streamFieldDraft` writes out what the
 * provider already said and **reads nothing at all** — no patient, no labs, no
 * messages, not even the review row. That is not an optimisation: a field draft
 * promises the provider that every fact in it is one of theirs, and the only way
 * to keep that promise is to have nothing else on hand to leak into it.
 *
 * Model and token budget match the main app's `ai-reply-assistant` so the two
 * behave alike and cost the same per draft.
 */

const MODEL = 'gpt-5.5'
const MAX_TOKENS = 1500

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export type DraftInput = {
  reviewId: string
  task: AiTask
  existing: string
  instructions: string
  identity?: ReplyIdentity
}

/**
 * The patient a review is about.
 *
 * Resolved from the review id server-side rather than accepted from the caller.
 * This endpoint reads a patient's entire billing and message history, so taking
 * a patient id from the request body would turn it into a lookup tool for any
 * patient in the database — a far wider grant than the screen it serves.
 */
async function subjectOf(
  reviewId: string
): Promise<{ patientId: string; reportId: string | null } | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('lab_reviews')
    .select('patient_id, report_id')
    .eq('id', reviewId)
    .maybeSingle()

  if (error || !data?.patient_id) return null
  return {
    patientId: data.patient_id as string,
    reportId: (data.report_id as string | null) ?? null,
  }
}

export type DraftStream =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: string }

export async function streamDraft(input: DraftInput): Promise<DraftStream> {
  if (!aiConfigured()) {
    return { ok: false, error: 'The AI assistant is not configured in this environment.' }
  }

  const subject = await subjectOf(input.reviewId)
  if (!subject) return { ok: false, error: 'Could not find this review.' }

  const context = await fetchPatientContext(subject.patientId, subject.reportId)

  return streamCompletion({
    system: systemPromptFor(input.task, input.identity),
    user: userPromptFor({
      task: input.task,
      existing: input.existing,
      instructions: input.instructions,
      context: formatPatientContext(context),
    }),
  })
}

export type FieldDraftInput = {
  field: ReviewField
  /** What is already in the field. */
  existing: string
  /** The provider's steer, typed in the assist modal. */
  instructions: string
  /** `describeDecision` output — the provider's other entries in this review. */
  recorded: string
  /** What to call the patient, for a field they read. Empty for the rest. */
  firstName: string
}

/**
 * Draft one field of a review from the provider's own words.
 *
 * Takes no review id, because there is nothing to look up: everything the model
 * is allowed to know arrives in the request, having been read off the flyout the
 * provider is asking from. Access is still checked by the route — this is a
 * staff-only tool — but no patient record is touched. The first name is the one
 * thing here that is not the provider's own prose, and it goes no further than
 * the salutation of a message they are about to read and approve.
 */
export async function streamFieldDraft(input: FieldDraftInput): Promise<DraftStream> {
  if (!aiConfigured()) {
    return { ok: false, error: 'The AI assistant is not configured in this environment.' }
  }

  return streamCompletion({
    system: systemPromptForField(input.field),
    user: userPromptForField({
      field: input.field,
      existing: input.existing,
      instructions: input.instructions,
      recorded: input.recorded,
      firstName: input.firstName,
    }),
  })
}

/** The one place either kind of draft reaches OpenAI. */
async function streamCompletion({
  system,
  user,
}: {
  system: string
  user: string
}): Promise<DraftStream> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  let completion
  try {
    completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_completion_tokens: MAX_TOKENS,
      stream: true,
    })
  } catch (error) {
    console.error('[ai/draft] request failed:', error)
    return { ok: false, error: 'The assistant is unavailable right now. Write the note manually.' }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const text = chunk.choices[0]?.delta?.content
          if (text) controller.enqueue(encoder.encode(text))
        }
      } catch (error) {
        // The response has already begun, so the status code is spent. Ending
        // the stream leaves the provider holding a half-written draft they can
        // finish by hand, which beats silently truncating with no explanation.
        console.error('[ai/draft] stream broke:', error)
        controller.enqueue(encoder.encode('\n\n[The draft was cut off. Please finish it manually.]'))
      } finally {
        controller.close()
      }
    },
  })

  return { ok: true, stream }
}
