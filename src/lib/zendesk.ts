import 'server-only'

/**
 * Zendesk **send** path only.
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
 */

const ZENDESK_DOMAIN = process.env.ZENDESK_DOMAIN || 'alphamd.zendesk.com'
const ZENDESK_ACCOUNT_EMAIL = process.env.ZENDESK_API_EMAIL || 'alphaai@alphamd.org'

export type ReplyResult =
  | { ok: true; warning?: string }
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

export async function replyToTicket(options: {
  ticketId: string
  body: string
  /** The signed-in provider. Used only to try to attribute the comment. */
  authorEmail: string
}): Promise<ReplyResult> {
  const { ticketId, body, authorEmail } = options

  if (!body.trim()) return { ok: false, error: 'Message is empty.' }
  if (!ticketId) return { ok: false, error: 'No Zendesk ticket to reply to.' }

  const auth = basicAuth()
  if (!auth) {
    return { ok: false, error: 'Zendesk is not configured (ZENDESK_API_TOKEN is unset).' }
  }

  const authorId = await publicCapableAuthorId(authorEmail, auth)

  const comment: { html_body: string; public: true; author_id?: number } = {
    html_body: toHtml(body.trim()),
    public: true,
  }
  if (authorId) comment.author_id = authorId

  let response: Response
  try {
    response = await fetch(`https://${ZENDESK_DOMAIN}/api/v2/tickets/${ticketId}.json`, {
      method: 'PUT',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: { comment } }),
    })
  } catch (error) {
    return { ok: false, error: `Could not reach Zendesk: ${(error as Error).message}` }
  }

  if (!response.ok) {
    return { ok: false, error: `Zendesk rejected the reply (${response.status}).` }
  }

  const data = (await response.json()) as {
    audit?: { events?: { type: string; public?: boolean }[] }
  }
  const commentEvent = data.audit?.events?.find((e) => e.type === 'Comment')

  if (commentEvent?.public === false) {
    return {
      ok: true,
      warning:
        'Zendesk stored this reply as an internal note, so the patient will NOT receive it. Do not resend — ask an admin to check your Zendesk seat.',
    }
  }

  return { ok: true }
}
