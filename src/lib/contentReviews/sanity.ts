import 'server-only'

import type { SanityReviewDocument } from './view'

/**
 * Read-only Sanity access for Content Reviews. Published perspective, and the
 * live API rather than the CDN: the `_rev` a decision is recorded against must
 * be the one that is published now, not a cached one. The dataset is public,
 * so no token. This portal never writes to Sanity.
 */

const PROJECT_ID = process.env.SANITY_PROJECT_ID || '7d91el5o'
const DATASET = process.env.SANITY_DATASET || 'production'
const API_VERSION = process.env.SANITY_API_VERSION || '2024-01-01'

async function query<T>(groq: string, params: Record<string, unknown>): Promise<T> {
  const url = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/query/${DATASET}?perspective=published`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: groq, params }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Sanity query failed (HTTP ${response.status})`)
  const body = (await response.json()) as { result: T }
  return body.result
}

/**
 * Published `_rev` per document id. A missing id is not published. `null` when
 * Sanity could not be reached: callers must not read that as "changed".
 */
export async function fetchCurrentRevs(ids: string[]): Promise<Map<string, string> | null> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  try {
    const rows = await query<{ _id: string; _rev: string }[]>('*[_id in $ids]{_id, _rev}', {
      ids: unique,
    })
    return new Map(rows.map((r) => [r._id, r._rev]))
  } catch {
    return null
  }
}

/** The published `_rev` of one document: `null` unpublished, `undefined` unreachable. */
export async function fetchCurrentRev(id: string): Promise<string | null | undefined> {
  const revs = await fetchCurrentRevs([id])
  if (!revs) return undefined
  return revs.get(id) ?? null
}

/** The published document, or null when it is not published. Throws when Sanity is unreachable. */
export async function fetchReviewDocument(id: string): Promise<SanityReviewDocument | null> {
  return query<SanityReviewDocument | null>('*[_id == $id][0]', { id })
}
