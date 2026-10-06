import Link from 'next/link'
import { redirect } from 'next/navigation'

import { checkProviderAccess } from '@/lib/authz'
import {
  listFinishedProviderQuestions,
  listOpenProviderQuestions,
} from '@/lib/providerQuestions/queries'
import { isAged } from '@/lib/providerQuestions/queueRow'
import { AccessDenied } from '@/components/access-denied'
import { PortalChrome } from '@/components/portal-chrome'
import { QuestionList } from '@/components/question-list'

export const metadata = { title: 'Provider Questions | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

type View = 'open' | 'finished'

const TABS: { id: View; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'finished', label: 'Finished' },
]

/**
 * The Provider Question pile.
 *
 * Open is the pile: queued and in-progress rows, Urgent first, oldest first.
 * Any Working Provider may take a row from here. Finished is history; a later
 * patient reply is a new Provider Question, so nothing here reopens.
 */
export default async function ProviderQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const access = await checkProviderAccess()
  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login?redirect=%2Fprovider-questions')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <AccessDenied />
  }

  const { view: viewParam } = await searchParams
  const view: View = viewParam === 'finished' ? 'finished' : 'open'

  const questions =
    view === 'open' ? await listOpenProviderQuestions() : await listFinishedProviderQuestions()

  const urgentCount = questions.filter((q) => q.urgent).length
  const agedCount = view === 'open' ? questions.filter((q) => isAged(q)).length : 0
  const mineCount = questions.filter((q) => q.assignedTo === access.access.userId).length

  return (
    <>
      <PortalChrome />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Provider Questions</h1>
            <p className="text-sm text-muted-foreground">
              {view === 'open'
                ? 'Patient medical questions waiting on a provider. Urgent first, then oldest first.'
                : 'Finished questions, most recent first.'}
            </p>
          </header>

          <nav className="mt-6 flex gap-1 border-b" aria-label="Question status">
            {TABS.map((tab) => {
              const isCurrent = tab.id === view
              return (
                <Link
                  key={tab.id}
                  href={tab.id === 'open' ? '/provider-questions' : `/provider-questions?view=${tab.id}`}
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

          {questions.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              {view === 'open'
                ? 'Nothing waiting. Customer service creates Provider Questions from the patient page or a Zendesk ticket.'
                : 'No Provider Questions have been finished yet.'}
            </p>
          ) : (
            <div className="mt-4">
              <QuestionList
                questions={questions}
                viewerId={access.access.userId}
                numbered={view === 'open'}
              />
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            {[
              `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`,
              view,
              mineCount ? `${mineCount} mine` : null,
              urgentCount ? `${urgentCount} urgent` : null,
              agedCount ? `${agedCount} aged` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </main>
    </>
  )
}
