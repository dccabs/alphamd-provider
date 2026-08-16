/**
 * Result shapes the lab-review screen holds in state, and their idle values.
 *
 * These live outside `actions.ts` because a `'use server'` module may only
 * export async functions — Next.js turns any other export into an action
 * reference, so a plain object there fails the whole route at import time.
 */

/**
 * Result shape shared by every mutation on this screen.
 *
 * `warning` means the change *did* land but something about it needs saying —
 * today that is an audit entry that failed to write. It is deliberately not an
 * error: telling a provider their work was rejected when it was saved would send
 * them to do it twice.
 */
export type WriteState =
  | { status: 'idle' }
  | { status: 'ok'; warning?: string }
  | { status: 'error'; message: string }

export const IDLE: WriteState = { status: 'idle' }
