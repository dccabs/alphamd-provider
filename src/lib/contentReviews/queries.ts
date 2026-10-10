import 'server-only'

import { namesFor } from '@/lib/labReviews/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { latestPerDocument, parseFlags, splitByTab, type ReviewFlag } from './lists'
import { fetchCurrentRevs } from './sanity'
import { isContentReviewStatus, reviewStanding, type ContentReviewStatus, type ReviewStanding } from './standing'
import { isContentReviewDocumentType, type ContentReviewDocumentType } from './view'

/**
 * Reads for the Content Review queue and review screen. Service role, like the
 * other queues; callers must run `checkContentReviewerAccess()` first.
 */

const ROW_SELECT =
  'id, sanity_document_id, document_type, slug, title, status, priority, source, flags, assigned_to, reviewed_rev, reviewed_by, reviewed_at, reviewer_comments, approved_at, previous_review_id, created_at, started_at'

/** PostgREST's default row cap. */
const PAGE = 1000

type DbRow = {
  id: string
  sanity_document_id: string
  document_type: string
  slug: string
  title: string
  status: string
  priority: number
  source: string
  flags: unknown
  assigned_to: string | null
  reviewed_rev: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_comments: string | null
  approved_at: string | null
  previous_review_id: string | null
  created_at: string | null
  started_at: string | null
}

export type ContentReviewRow = {
  id: string
  sanityDocumentId: string
  documentType: ContentReviewDocumentType
  slug: string
  title: string
  status: ContentReviewStatus
  /** Status read against the published `_rev`. */
  standing: ReviewStanding
  priority: number
  source: string
  flags: ReviewFlag[]
  assignedTo: string | null
  assignedToName: string | null
  reviewedRev: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  reviewerComments: string | null
  approvedAt: string | null
  previousReviewId: string | null
  createdAt: string | null
  startedAt: string | null
}

function toRow(
  r: DbRow,
  names: Map<string, string>,
  currentRev: string | null | undefined
): ContentReviewRow {
  const status: ContentReviewStatus = isContentReviewStatus(r.status) ? r.status : 'queued'
  return {
    id: r.id,
    sanityDocumentId: r.sanity_document_id,
    documentType: isContentReviewDocumentType(r.document_type) ? r.document_type : 'resources',
    slug: r.slug,
    title: r.title,
    status,
    standing: reviewStanding({ status, reviewedRev: r.reviewed_rev }, currentRev),
    priority: r.priority,
    source: r.source,
    flags: parseFlags(r.flags),
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
    reviewedRev: r.reviewed_rev,
    reviewedByName: r.reviewed_by ? (names.get(r.reviewed_by) ?? null) : null,
    reviewedAt: r.reviewed_at,
    reviewerComments: r.reviewer_comments,
    approvedAt: r.approved_at,
    previousReviewId: r.previous_review_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
  }
}

async function hydrate(
  rows: DbRow[],
  revs: Map<string, string> | null
): Promise<ContentReviewRow[]> {
  const staff = rows.flatMap((r) => [r.assigned_to, r.reviewed_by]).filter(Boolean) as string[]
  const names = await namesFor(staff, 'Unknown reviewer')
  return rows.map((r) =>
    toRow(r, names, revs ? (revs.get(r.sanity_document_id) ?? null) : undefined)
  )
}

export type ContentReviewLists = {
  queue: ContentReviewRow[]
  changesRequested: ContentReviewRow[]
  approved: ContentReviewRow[]
  /** False when Sanity could not be reached: stale and revised pages are not detected. */
  revsChecked: boolean
}

/** Every document's newest review, read against what Sanity publishes now. */
export async function listContentReviews(): Promise<ContentReviewLists> {
  const admin = createAdminClient()
  const all: DbRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('content_reviews')
      .select(ROW_SELECT)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`content_reviews query failed: ${error.message}`)
    all.push(...((data ?? []) as DbRow[]))
    if ((data?.length ?? 0) < PAGE) break
  }

  const latest = latestPerDocument(
    all.map((r) => ({ ...r, sanityDocumentId: r.sanity_document_id, createdAt: r.created_at }))
  )
  const revs = await fetchCurrentRevs(latest.map((r) => r.sanity_document_id))
  return { ...splitByTab(await hydrate(latest, revs)), revsChecked: revs !== null }
}

export type ContentReviewDetail = {
  review: ContentReviewRow
  /** Every review of this document, newest first, this one included. */
  history: ContentReviewRow[]
  /** True when this is the document's newest review. Older ones are read-only. */
  isLatest: boolean
}

/**
 * One review and its document's history. `currentRev` is the `_rev` of the
 * document the caller has just fetched to render (see `reviewStanding`).
 */
export async function getContentReview(
  db: DbRow,
  currentRev: string | null | undefined
): Promise<ContentReviewDetail | null> {
  const id = db.id
  const { data: siblings, error: historyError } = await createAdminClient()
    .from('content_reviews')
    .select(ROW_SELECT)
    .eq('sanity_document_id', db.sanity_document_id)
    .order('created_at', { ascending: false })
  if (historyError) throw new Error(`content_reviews history failed: ${historyError.message}`)

  const revs =
    currentRev === undefined ? null : new Map(currentRev ? [[db.sanity_document_id, currentRev]] : [])
  const history = await hydrate((siblings ?? []) as DbRow[], revs)
  const review = history.find((r) => r.id === id)
  if (!review) return null
  return { review, history, isLatest: history[0]?.id === id }
}

/** The newest review of a document, for the guard before a write. */
export async function loadLatestForDocument(sanityDocumentId: string): Promise<DbRow | null> {
  const { data, error } = await createAdminClient()
    .from('content_reviews')
    .select(ROW_SELECT)
    .eq('sanity_document_id', sanityDocumentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`content_reviews lookup failed: ${error.message}`)
  return (data as DbRow | null) ?? null
}

export async function loadReview(id: string): Promise<DbRow | null> {
  const { data, error } = await createAdminClient()
    .from('content_reviews')
    .select(ROW_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`content_reviews lookup failed: ${error.message}`)
  return (data as DbRow | null) ?? null
}

export type { DbRow as ContentReviewDbRow }
