import 'server-only'

import type { ReplyIdentity } from '@/lib/labReviews/replyIdentity'

/**
 * Zendesk **send** path only: reply to an existing ticket, or create a new one
 * (`POST /api/v2/tickets.json`) for a lab-review patient message.
 *
 * Reading the thread is a database query against `zendesk_last_contact` (see
 * `labReviews/tabs.ts`) — the comments are already mirrored into Postgres by a
 * webhook, so going to the API to read them would be a slower, rate-limited
 * route to data we already have.
 *
 * The rule this implements, and why it is not optional:
 *
 *   Zendesk silently forces comments authored by light agents (`role_type` 1),
 *   chat agents (2) and contributors (3) to be **private**, ignoring
 *   `public: true`. It returns 200. Nothing errors. The patient simply never
 *   receives the message.
 *
 * Providers are precisely the population most likely to hold a light-agent seat
 * or to have no Zendesk account at all, so this is the default case here, not
 * an edge case. The guard is written as a **positive allowlist** — only a
 * Zendesk `admin`, or a full agent (`role === 'agent'` with `role_type` null or
 * 0), may be named as the author of a public comment. Anyone else, and anyone
 * not found, posts from the service account instead, which can.
 *
 * Even then Zendesk can still store the comment as internal, so the response
 * audit is checked and a warning is returned rather than reporting plain
 * success.
 *
 * On top of that the caller now *chooses* an identity — as themselves, or as the
 * unnamed "AlphaMD Support" service account. Choosing `self` is a request, not a
 * guarantee: the allowlist above can still route it to the service account, so
 * the result reports `sentAs` and the composer says which one actually went out.
 * That fallback used to be silent, which is exactly what made an explicit choice
 * worth having.
 */

const ZENDESK_DOMAIN = zendeskHost(process.env.ZENDESK_DOMAIN, 'alphamd.zendesk.com')
const ZENDESK_ACCOUNT_EMAIL = process.env.ZENDESK_API_EMAIL?.trim() || 'alphaai@alphamd.org'

/** `.env` is not JavaScript: a pasted `process.env.X || '…'` is a hostname of
 *  that whole string, and `fetch` then fails with a URL nobody can read. */
function zendeskHost(value: string | undefined, fallback: string): string {
  const host = value?.trim() ?? ''
  if (!host || host.includes('process.env') || host.includes(' ')) return fallback
  return host
}

export type ReplyResult =
  | { ok: true; sentAs: ReplyIdentity; warning?: string }
  | { ok: false; error: string }

export type CreateTicketResult =
  | { ok: true; ticketId: number; sentAs: ReplyIdentity; warning?: string }
  | { ok: false; error: string }

function basicAuth(): string | null {
  const token = process.env.ZENDESK_API_TOKEN
  if (!token) return null
  return Buffer.from(`${ZENDESK_ACCOUNT_EMAIL}/token:${token}`).toString('base64')
}

export function isZendeskConfigured(): boolean {
  return Boolean(process.env.ZENDESK_API_TOKEN)
}

/** Minimal HTML escape — the composer takes plain text, and Zendesk's
 *  `html_body` would otherwise interpret anything a provider types. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Resolve a Zendesk author id for `email`, but only if that user is allowed to
 * author public comments. Returns null to mean "post from the service account",
 * which is a success path, not a failure.
 */
async function publicCapableAuthorId(email: string, auth: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://${ZENDESK_DOMAIN}/api/v2/users/search.json?query=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } }
    )
    if (!response.ok) return null

    const data = (await response.json()) as {
      users?: { id: number; email?: string; role?: string; role_type?: number | null }[]
    }
    const match = data.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (!match) return null

    const isAdmin = match.role === 'admin'
    const isFullAgent =
      match.role === 'agent' && (match.role_type == null || match.role_type === 0)

    // Allowlist, not blocklist: an unrecognised role or a new role_type must
    // fall back to the service account, never be trusted to post publicly.
    if (!isAdmin && !isFullAgent) return null

    return match.id
  } catch {
    return null
  }
}

type PublicComment = { html_body: string; public: true; author_id?: number }

type ZendeskAudit = { events?: { type: string; public?: boolean }[] }

/** Asking for `support` skips the lookup: an omitted `author_id` is what makes
 *  Zendesk attribute the comment to the service account. */
async function commentAuthor(
  as: ReplyIdentity,
  authorEmail: string,
  auth: string
): Promise<{ authorId: number | null; sentAs: ReplyIdentity }> {
  const authorId = as === 'self' ? await publicCapableAuthorId(authorEmail, auth) : null
  return { authorId, sentAs: authorId ? 'self' : 'support' }
}

function publicComment(body: string, authorId: number | null): PublicComment {
  const comment: PublicComment = { html_body: toHtml(body.trim()), public: true }
  if (authorId) comment.author_id = authorId
  return comment
}

function commentEventOf(audit: ZendeskAudit | undefined) {
  return audit?.events?.find((e) => e.type === 'Comment')
}

function publicCommentWarning(
  as: ReplyIdentity,
  sentAs: ReplyIdentity,
  commentEvent: { public?: boolean } | undefined,
  noun: 'reply' | 'message'
): string | undefined {
  if (commentEvent?.public === false) {
    return `Zendesk stored this ${noun} as an internal note, so the patient will NOT receive it. Do not resend — ask an admin to check your Zendesk seat.`
  }
  if (as === 'self' && sentAs === 'support') {
    return 'Sent as AlphaMD Support, not under your name — your Zendesk seat cannot author public replies. The patient did receive it.'
  }
  return undefined
}

export async function replyToTicket(options: {
  ticketId: string
  body: string
  /** The signed-in provider. Used only to try to attribute the comment. */
  authorEmail: string
  /** Defaults to `self` so existing callers keep attributing where they can. */
  as?: ReplyIdentity
}): Promise<ReplyResult> {
  const { ticketId, body, authorEmail, as = 'self' } = options

  if (!body.trim()) return { ok: false, error: 'Message is empty.' }
  if (!ticketId) return { ok: false, error: 'No Zendesk ticket to reply to.' }

  const auth = basicAuth()
  if (!auth) {
    return { ok: false, error: 'Zendesk is not configured (ZENDESK_API_TOKEN is unset).' }
  }

  const { authorId, sentAs } = await commentAuthor(as, authorEmail, auth)

  let response: Response
  try {
    response = await fetch(`https://${ZENDESK_DOMAIN}/api/v2/tickets/${ticketId}.json`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: { comment: publicComment(body, authorId) } }),
    })
  } catch (error) {
    return { ok: false, error: `Could not reach Zendesk: ${(error as Error).message}` }
  }

  if (!response.ok) {
    return { ok: false, error: `Zendesk rejected the reply (${response.status}).` }
  }

  const data = (await response.json()) as { audit?: ZendeskAudit }
  return {
    ok: true,
    sentAs,
    warning: publicCommentWarning(as, sentAs, commentEventOf(data.audit), 'reply'),
  }
}

/**
 * Open a new ticket whose first comment is the public patient message.
 *
 * Same public-comment allowlist as `replyToTicket`: a light-agent seat must not
 * be named as author, or Zendesk stores the comment internal and the patient
 * never sees it. The Alpha admin `create-ticket` path skipped that guard;
 * `create-user-ticket` did not. This follows the guarded one.
 */
export async function createTicket(options: {
  subject: string
  body: string
  requesterName: string
  requesterEmail: string
  status: string
  groupId: number
  authorEmail: string
  as?: ReplyIdentity
}): Promise<CreateTicketResult> {
  const {
    subject,
    body,
    requesterName,
    requesterEmail,
    status,
    groupId,
    authorEmail,
    as = 'self',
  } = options

  if (!body.trim()) return { ok: false, error: 'Message is empty.' }
  if (!requesterEmail.trim()) return { ok: false, error: 'No email address to send to.' }

  const auth = basicAuth()
  if (!auth) {
    return { ok: false, error: 'Zendesk is not configured (ZENDESK_API_TOKEN is unset).' }
  }

  const { authorId, sentAs } = await commentAuthor(as, authorEmail, auth)

  let response: Response
  try {
    response = await fetch(`https://${ZENDESK_DOMAIN}/api/v2/tickets.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket: {
          subject,
          requester: { name: requesterName, email: requesterEmail },
          status,
          group_id: groupId,
          comment: publicComment(body, authorId),
        },
      }),
    })
  } catch (error) {
    return { ok: false, error: `Could not reach Zendesk: ${(error as Error).message}` }
  }

  if (!response.ok) {
    return { ok: false, error: `Zendesk rejected the ticket (${response.status}).` }
  }

  const data = (await response.json()) as {
    ticket?: { id?: number }
    audit?: ZendeskAudit
  }
  const ticketId = data.ticket?.id
  if (!ticketId) {
    return { ok: false, error: 'Zendesk created a ticket but did not return its id.' }
  }

  return {
    ok: true,
    ticketId,
    sentAs,
    warning: publicCommentWarning(as, sentAs, commentEventOf(data.audit), 'message'),
  }
}
