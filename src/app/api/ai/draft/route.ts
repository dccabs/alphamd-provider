import { checkProviderAccess } from '@/lib/authz'
import { streamDraft, streamFieldDraft, type DraftStream } from '@/lib/ai/draft'
import { isReviewField } from '@/lib/ai/reviewFields'
import { isAiTask } from '@/lib/ai/tasks'
import { isReplyIdentity } from '@/lib/labReviews/replyIdentity'

/**
 * The one non-server-action endpoint in this app.
 *
 * Server actions cannot stream a partial result, and a clinical note that
 * appears a word at a time is the difference between a tool that feels
 * responsive and one that looks hung for fifteen seconds. So this is a route
 * handler returning `text/plain`, matching the main app's transport exactly.
 *
 * Two request shapes. A `task` drafts from the patient's history and needs a
 * review to resolve them from; a `field` drafts one box of the review flyout from
 * what the provider typed and reads nothing, so it needs no review id.
 *
 * Like every server action here it re-checks access itself: this is a public
 * HTTP endpoint, and one of its two shapes reads a patient's full history.
 */

export const runtime = 'nodejs'
/** Long enough for a 1,500-token completion on a slow day. */
export const maxDuration = 60

export async function POST(request: Request) {
  const access = await checkProviderAccess()
  if (!access.ok) {
    return new Response('Your session has expired. Reload the page and sign in again.', {
      status: 401,
    })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Malformed request.', { status: 400 })
  }

  const input = body as Record<string, unknown>
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

  let result: DraftStream

  if (isReviewField(input.field)) {
    result = await streamFieldDraft({
      field: input.field,
      existing: text('existing'),
      instructions: text('instructions'),
      recorded: text('recorded'),
      firstName: text('firstName'),
    })
  } else {
    const reviewId = text('reviewId')
    const task = input.task

    if (!reviewId) return new Response('Missing review.', { status: 400 })
    if (!isAiTask(task)) return new Response('Unknown drafting task.', { status: 400 })

    const identityValue = typeof input.identity === 'string' ? input.identity : undefined

    result = await streamDraft({
      reviewId,
      task,
      existing: text('existing'),
      instructions: text('instructions'),
      identity: isReplyIdentity(identityValue) ? identityValue : undefined,
    })
  }

  if (!result.ok) return new Response(result.error, { status: 503 })

  return new Response(result.stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      // Vercel's proxy buffers by default, which would defeat the point of
      // streaming.
      'X-Accel-Buffering': 'no',
    },
  })
}
