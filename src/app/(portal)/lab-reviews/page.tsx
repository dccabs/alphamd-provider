import Link from 'next/link'
import { redirect } from 'next/navigation'

import { checkProviderAccess } from '@/lib/authz'
import {
  getQueuePatient,
  isLabReviewStatus,
  listLabReviews,
  listLabReviewsForPatient,
  type LabReviewStatus,
} from '@/lib/labReviews/queries'
import { AccessDenied } from '@/components/access-denied'
import { PortalChrome } from '@/components/portal-chrome'
import { QueueList } from '@/components/queue-list'
import { progressOf } from '@/lib/labReviews/queueRow'
import { PatientSearch } from './PatientSearch'

export const metadata = { title: 'Lab reviews | Alpha MD Provider' }

const STATUS_TABS: { id: LabReviewStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'needs_attention', label: 'Needs attention' },
  { id: 'finished', label: 'Finished' },
]

const EMPTY_COPY: Record<LabReviewStatus, string> = {
  active: 'Nothing waiting. New labs arrive here from incoming faxes and patient uploads.',
  needs_attention: 'No reviews have been flagged for attention.',
  finished: 'No reviews have been finished yet.',
}

export default async function LabReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; patient?: string }>
}) {
  const access = await checkProviderAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login?redirect=%2Flab-reviews')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <AccessDenied />
  }

  const { status: statusParam, patient: patientParam } = await searchParams
  const status: LabReviewStatus = isLabReviewStatus(statusParam) ? statusParam : 'active'
  const patientId = patientParam?.trim() || null

  const [reviews, selected] = patientId
    ? await Promise.all([listLabReviewsForPatient(patientId), getQueuePatient(patientId)])
    : [await listLabReviews(status), null]

  const selectedPatient = patientId
    ? (selected ?? { patientId, name: 'Unknown patient', email: null })
    : null
  const inProgressCount = reviews.filter((r) => progressOf(r) === 'in_progress').length

  return (
    <>
      <PortalChrome />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Lab reviews</h1>
            <p className="text-sm text-muted-foreground">
              {patientId
                ? 'All reviews for this patient, newest first.'
                : 'Labs waiting on a provider, newest first.'}
            </p>
          </header>

          <div className="mt-6">
            <PatientSearch
              key={selectedPatient?.patientId ?? 'none'}
              selected={selectedPatient}
            />
          </div>

          {!patientId && (
            <nav className="mt-6 flex gap-1 border-b" aria-label="Review status">
              {STATUS_TABS.map((tab) => {
                const isCurrent = tab.id === status
                return (
                  <Link
                    key={tab.id}
                    href={tab.id === 'active' ? '/lab-reviews' : `/lab-reviews?status=${tab.id}`}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={
                      isCurrent
                        ? 'border-b-2 border-foreground px-3 py-2 text-sm font-medium'
                        : 'border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground'
                    }
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
          )}

          {reviews.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              {patientId ? 'No lab reviews for this patient.' : EMPTY_COPY[status]}
            </p>
          ) : (
            <div className="mt-4">
              <QueueList reviews={reviews} numbered={!patientId} />
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {[
              `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`,
              patientId ? null : STATUS_TABS.find((t) => t.id === status)?.label.toLowerCase(),
              inProgressCount ? `${inProgressCount} in progress` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </main>
    </>
  )
}

export const dynamic = 'force-dynamic'
