/**
 * Who a customer-service reply is attributed to.
 *
 * Separate from `@/lib/zendesk` on purpose: that module is `server-only` because
 * it holds the API token, and the composer that offers this choice is a client
 * component. Keeping the vocabulary here lets both sides name the same two
 * identities without dragging the token toward the browser bundle.
 *
 * `self` is a *request*, not a guarantee. Zendesk silently forces comments from
 * light agents, chat agents and contributors to be private, so `replyToTicket`
 * only names a provider as author when their seat allows public comments and
 * otherwise falls back to `support`. What actually happened comes back as
 * `sentAs`.
 */

export const REPLY_IDENTITIES = ['self', 'support'] as const
export type ReplyIdentity = (typeof REPLY_IDENTITIES)[number]

export function isReplyIdentity(value: string | undefined): value is ReplyIdentity {
  return !!value && (REPLY_IDENTITIES as readonly string[]).includes(value)
}

export const REPLY_IDENTITY_LABELS: Record<ReplyIdentity, string> = {
  self: 'as me',
  support: 'as AlphaMD Support',
}

/** The identity a composer starts on. `self` keeps the behaviour the composer
 *  had before the choice existed — it always tried to attribute — and the
 *  fallback already covers the seat that cannot author publicly. */
export const DEFAULT_REPLY_IDENTITY: ReplyIdentity = 'self'
