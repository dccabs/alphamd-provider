import { isInQueue, type ReviewStanding } from './standing.ts'

/** A batch note the seed script put on the row for the reviewer. */
export type ReviewFlag = {
  label: string
  detail: string | null
  severity: string | null
  url: string | null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function parseFlags(value: unknown): ReviewFlag[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const e = entry as Record<string, unknown>
    const label = optionalString(e.label)
    if (!label) return []
    return [
      {
        label,
        detail: optionalString(e.detail),
        severity: optionalString(e.severity),
        url: optionalString(e.url),
      },
    ]
  })
}

/**
 * A document's reviews are its history; the newest one is where it stands.
 * At most one is open (a unique index), and it is always the newest.
 */
export function latestPerDocument<T extends { sanityDocumentId: string; createdAt: string | null }>(
  rows: T[]
): T[] {
  const latest = new Map<string, T>()
  for (const row of rows) {
    const seen = latest.get(row.sanityDocumentId)
    if (!seen || (row.createdAt ?? '') > (seen.createdAt ?? '')) latest.set(row.sanityDocumentId, row)
  }
  return [...latest.values()]
}

function byTimeDesc(key: 'reviewedAt' | 'approvedAt') {
  return (a: Record<typeof key, string | null>, b: Record<typeof key, string | null>) =>
    (b[key] ?? '').localeCompare(a[key] ?? '')
}

/**
 * The three tabs. Queue: work a reviewer could pick up, lowest priority number
 * first, then oldest. Changes requested: waiting on the editor. Approved: the
 * published version is approved.
 */
export function splitByTab<
  T extends {
    standing: ReviewStanding
    priority: number
    createdAt: string | null
    reviewedAt: string | null
    approvedAt: string | null
  },
>(rows: T[]): { queue: T[]; changesRequested: T[]; approved: T[] } {
  const queue = rows
    .filter((r) => isInQueue(r.standing))
    .sort((a, b) => a.priority - b.priority || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  const changesRequested = rows
    .filter((r) => r.standing === 'changes_requested')
    .sort(byTimeDesc('reviewedAt'))
  const approved = rows.filter((r) => r.standing === 'approved').sort(byTimeDesc('approvedAt'))
  return { queue, changesRequested, approved }
}
