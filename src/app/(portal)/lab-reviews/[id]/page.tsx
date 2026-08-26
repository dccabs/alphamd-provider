import { notFound, redirect } from 'next/navigation'

import { checkProviderAccess } from '@/lib/authz'
import { AccessDenied } from '@/components/access-denied'
import {
  getDosageOptions,
  getLabReview,
  getMedicationCatalog,
  getMedications,
  getPatientDiscountEligibility,
  getPatientHeader,
  listProviders,
} from '@/lib/labReviews/queries'
import { listLabReviewEvents, listLabReviewNotes, resolveActor } from '@/lib/labReviews/events'
import { listLabProviders, listScheduledLabOrders } from '@/lib/labOrders/queries'
import {
  getConsultations,
  getCsThreads,
  getFiles,
  getNotes,
  getOrders,
} from '@/lib/labReviews/tabs'
import { signLabFile } from '@/lib/labReviews/storage'
import { parseSummary } from '@/lib/labReviews/summaryMarkdown'
import { LabReviewScreen } from './LabReviewScreen'

export const metadata = { title: 'Lab review | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

export default async function LabReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const access = await checkProviderAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') {
      redirect(`/login?redirect=${encodeURIComponent(`/lab-reviews/${id}`)}`)
    }
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <AccessDenied />
  }

  const review = await getLabReview(id)
  if (!review) notFound()

  const [
    header,
    notes,
    medications,
    orders,
    files,
    cs,
    consultations,
    providers,
    events,
    reviewNotes,
    labProviders,
    scheduledLabs,
    catalog,
    dosageOptions,
    // The same name `completeLabReview` will write onto the chart note, resolved
    // here so the confirmation screen can show that note as it will actually
    // read. Falls back to the email exactly as the write path does.
    actor,
    eligibility,
  ] = await Promise.all([
    getPatientHeader(review.patientId),
    getNotes(review.patientId),
    getMedications(review.patientId),
    getOrders(review.patientId),
    getFiles(review.patientId),
    getCsThreads(review.patientId, access.access.userId),
    getConsultations(review.patientId),
    listProviders(),
    listLabReviewEvents(id),
    listLabReviewNotes(id),
    listLabProviders(),
    listScheduledLabOrders(review.patientId),
    getMedicationCatalog(),
    getDosageOptions(),
    resolveActor(access.access),
    getPatientDiscountEligibility(review.patientId),
  ])

  if (!header) notFound()

  // The review's own source file is what the viewer should open on, falling
  // back to the newest lab file the patient has.
  const sourcePath = review.sources.find((s) => s.filePath)?.filePath ?? null
  const initialFile =
    (sourcePath && files.find((f) => f.path === sourcePath)) ||
    files.find((f) => f.path.startsWith('original-test-results/')) ||
    null

  // Depends on which file the batch above picked, so it waits.
  const initialSignedUrl = initialFile ? await signLabFile(initialFile.path) : null

  return (
    <LabReviewScreen
      reviewId={review.id}
      header={header}
      reviewStatus={review.status}
      assignedTo={review.assignedTo}
      assignedToName={review.assignedToName}
      startedAt={review.startedAt}
      startedByName={review.startedByName}
      queuePosition={review.queuePosition}
      queueTotal={review.queueTotal}
      viewerId={access.access.userId}
      viewerName={actor.displayName}
      providers={providers}
      labProviders={labProviders}
      scheduledLabs={scheduledLabs}
      events={events}
      reviewNotes={reviewNotes}
      needsAttentionReason={review.needsAttentionReason}
      draft={review.draft}
      draftUpdatedAt={review.draftUpdatedAt}
      summaryBlocks={parseSummary(review.report?.patientSummary)}
      summaryStatus={review.summaryStatus}
      summaryError={review.summaryError}
      summaryGeneratedAt={review.report?.createdAt ?? null}
      analytes={review.report?.analytes ?? []}
      collectionDate={review.report?.collectionDate ?? null}
      sourceFileName={review.report?.sourceFileName ?? null}
      notes={notes}
      medications={medications}
      catalog={catalog}
      dosageOptions={dosageOptions}
      orders={orders}
      files={files}
      cs={cs}
      consultations={consultations}
      initialFile={initialFile}
      initialSignedUrl={initialSignedUrl}
      initialSignError={
        initialFile && !initialSignedUrl ? 'Could not create a link for this file.' : null
      }
      inNewsletter={eligibility.inNewsletter}
      assignedCoupon={eligibility.coupon}
      subscriptionMedicationIds={eligibility.subscriptionMedicationIds}
    />
  )
}
