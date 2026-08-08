import { notFound, redirect } from 'next/navigation'

import { checkProviderAccess } from '@/lib/authz'
import { AccessDenied } from '@/components/access-denied'
import { getLabReview, getMedications, getPatientHeader } from '@/lib/labReviews/queries'
import { getCsThread, getFiles, getNotes, getOrders } from '@/lib/labReviews/tabs'
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

  const [header, notes, medications, orders, files, cs] = await Promise.all([
    getPatientHeader(review.patientId),
    getNotes(review.patientId),
    getMedications(review.patientId),
    getOrders(review.patientId),
    getFiles(review.patientId),
    getCsThread(review.patientId, access.access.userId),
  ])

  if (!header) notFound()

  // The review's own source file is what the viewer should open on, falling
  // back to the newest lab file the patient has.
  const sourcePath = review.sources.find((s) => s.filePath)?.filePath ?? null
  const initialFile =
    (sourcePath && files.find((f) => f.path === sourcePath)) ||
    files.find((f) => f.path.startsWith('original-test-results/')) ||
    null

  const initialSignedUrl = initialFile ? await signLabFile(initialFile.path) : null

  return (
    <LabReviewScreen
      header={header}
      reviewStatus={review.status}
      assignedToName={review.assignedToName}
      queuePosition={review.queuePosition}
      queueTotal={review.queueTotal}
      viewerName={access.access.email}
      summaryBlocks={parseSummary(review.report?.patientSummary)}
      summaryStatus={review.summaryStatus}
      summaryError={review.summaryError}
      summaryGeneratedAt={review.report?.createdAt ?? null}
      analytes={review.report?.analytes ?? []}
      collectionDate={review.report?.collectionDate ?? null}
      notes={notes}
      medications={medications}
      orders={orders}
      files={files}
      cs={cs}
      initialFile={initialFile}
      initialSignedUrl={initialSignedUrl}
      initialSignError={
        initialFile && !initialSignedUrl ? 'Could not create a link for this file.' : null
      }
    />
  )
}
