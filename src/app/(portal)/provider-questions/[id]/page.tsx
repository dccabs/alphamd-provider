import { notFound, redirect } from 'next/navigation'

import { AccessDenied } from '@/components/access-denied'
import { checkProviderAccess } from '@/lib/authz'
import { listLabProviders, listScheduledLabOrders } from '@/lib/labOrders/queries'
import { resolveActor } from '@/lib/labReviews/events'
import { getDosageOptions, getMedications, getPatientHeader } from '@/lib/labReviews/queries'
import {
  getConsultations,
  getCsThreads,
  getFiles,
  getNotes,
  getOrders,
} from '@/lib/labReviews/tabs'
import { listProviderQuestionAttachments } from '@/lib/providerQuestions/attachments'
import { listProviderQuestionEvents } from '@/lib/providerQuestions/events'
import { getProviderQuestion } from '@/lib/providerQuestions/queries'

import { ProviderQuestionScreen } from './ProviderQuestionScreen'

export const metadata = { title: 'Provider Question | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

/**
 * Same data as the Lab Review page minus the report: the question is the
 * thing under review, so there is no AI summary, no analytes and no source
 * file. No document is shown until the provider picks one from the Files tab.
 */
export default async function ProviderQuestionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const access = await checkProviderAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') {
      redirect(`/login?redirect=${encodeURIComponent(`/provider-questions/${id}`)}`)
    }
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <AccessDenied />
  }

  const question = await getProviderQuestion(id)
  if (!question) notFound()

  const [
    header,
    notes,
    medications,
    orders,
    files,
    cs,
    consultations,
    events,
    labProviders,
    scheduledLabs,
    dosageOptions,
    actor,
    attachments,
  ] = await Promise.all([
    getPatientHeader(question.patientId),
    getNotes(question.patientId),
    getMedications(question.patientId),
    getOrders(question.patientId),
    getFiles(question.patientId),
    getCsThreads(question.patientId, access.access.userId),
    getConsultations(question.patientId),
    listProviderQuestionEvents(id),
    listLabProviders(),
    listScheduledLabOrders(question.patientId),
    getDosageOptions(),
    resolveActor(access.access),
    listProviderQuestionAttachments(id),
  ])

  if (!header) notFound()

  return (
    <ProviderQuestionScreen
      questionId={question.id}
      header={header}
      status={question.status}
      question={question.question}
      csComments={question.csComments}
      attachments={attachments}
      urgent={question.urgent}
      zendeskTicketId={question.zendeskTicketId}
      assignedTo={question.assignedTo}
      assignedToName={question.assignedToName}
      createdAt={question.createdAt}
      createdByName={question.createdByName}
      startedAt={question.startedAt}
      finishedAt={question.finishedAt}
      finishedByName={question.finishedByName}
      resolution={question.resolution}
      answer={question.answer}
      openCountForPatient={question.openCountForPatient}
      viewerId={access.access.userId}
      viewerName={actor.displayName}
      labProviders={labProviders}
      scheduledLabs={scheduledLabs}
      events={events}
      draft={question.draft}
      draftUpdatedAt={question.draftUpdatedAt}
      notes={notes}
      medications={medications}
      dosageOptions={dosageOptions}
      orders={orders}
      files={files}
      cs={cs}
      consultations={consultations}
    />
  )
}
