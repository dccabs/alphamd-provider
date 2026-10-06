import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { checkProviderAccess } from '@/lib/authz'
import { listMyOpenActions } from '@/lib/actions/queries'
import { parseDayKey } from '@/lib/consultations/day'
import { listProviderConsultations } from '@/lib/consultations/providerDay'
import { listLabReviews } from '@/lib/labReviews/queries'
import { listOpenProviderQuestions } from '@/lib/providerQuestions/queries'
import { PortalChrome } from '@/components/portal-chrome'
import { QuestionList } from '@/components/question-list'
import { QueueList } from '@/components/queue-list'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionsCard } from './_dashboard/ActionsCard'
import { ConsultationsCard } from './_dashboard/ConsultationsCard'
import { ScopeToggle } from './_dashboard/ScopeToggle'

export const metadata = { title: 'Dashboard | Alpha MD Provider' }
export const dynamic = 'force-dynamic'

/** Rows shown per work type before the "See all" link takes over. */
const ROWS = 3

/**
 * The provider landing page — where sign-in drops you.
 *
 * Three things a provider needs on arrival, in priority order: Lab reviews,
 * Provider Questions, and today's Consultations — plus any Actions assigned to
 * them. The two work lists each switch between the whole queue and what is
 * assigned to the viewer; consultations and actions sit in a rail because
 * neither is worked in this portal yet.
 *
 * The lists are the same `listLabReviews` / `listOpenProviderQuestions` the
 * queue pages use, deliberately, so the dashboard can never disagree with the
 * page it links to.
 *
 * The role check is intentionally *softer* here than on `/lab-reviews`. Any
 * `@alphamd.org` account may sign in, and this is the page they land on, so an
 * account without the provider or admin role gets the page with an explanation
 * instead of `<AccessDenied />`. Rendering the denial here would leave such a
 * user with nowhere at all to land after a successful login.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>
}) {
  const access = await checkProviderAccess()

  if (!access.ok) {
    if (access.reason === 'no-session') redirect('/login')
    if (access.reason === 'not-allowed-domain') redirect('/login?error=not_authorized')
    return <NoQueueAccess />
  }

  const { day } = await searchParams
  const dayParam = parseDayKey(day)
  const { userId, email } = access.access

  const [active, needsAttention, questions, consultations, actions] = await Promise.all([
    listLabReviews('active'),
    listLabReviews('needs_attention'),
    listOpenProviderQuestions(),
    listProviderConsultations(userId, dayParam),
    listMyOpenActions(userId),
  ])

  const reviews = [...needsAttention, ...active]
  const myReviews = reviews.filter((r) => r.assignedTo === userId)
  const myQuestions = questions.filter((q) => q.assignedTo === userId)
  const urgent = questions.filter((q) => q.urgent).length

  return (
    <>
      <PortalChrome />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {plural(myReviews.length, 'lab review')} and {plural(myQuestions.length, 'question')}{' '}
              assigned to you
            </p>
          </header>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="flex min-w-0 flex-col gap-10">
              <section aria-labelledby="lab-reviews-heading">
                <ScopeToggle
                  seeAllHref="/lab-reviews"
                  counts={{ all: reviews.length, mine: myReviews.length }}
                  header={
                    <SectionHeading
                      id="lab-reviews-heading"
                      title="Lab reviews"
                      count={reviews.length}
                      note={
                        needsAttention.length ? `${needsAttention.length} need attention` : null
                      }
                    />
                  }
                  all={
                    <Capped
                      total={reviews.length}
                      href="/lab-reviews"
                      noun="lab review"
                      empty="Nothing waiting. New labs arrive here from incoming faxes and patient uploads."
                    >
                      <QueueList reviews={reviews.slice(0, ROWS)} />
                    </Capped>
                  }
                  mine={
                    <Capped
                      total={myReviews.length}
                      href="/lab-reviews"
                      noun="lab review"
                      empty="Nothing is assigned to you. Open a review from All and it becomes yours."
                    >
                      <QueueList reviews={myReviews.slice(0, ROWS)} />
                    </Capped>
                  }
                />
              </section>

              <section aria-labelledby="provider-questions-heading">
                <ScopeToggle
                  seeAllHref="/provider-questions"
                  counts={{ all: questions.length, mine: myQuestions.length }}
                  header={
                    <SectionHeading
                      id="provider-questions-heading"
                      title="Provider Questions"
                      count={questions.length}
                      note={urgent ? `${urgent} urgent` : null}
                    />
                  }
                  all={
                    <Capped
                      total={questions.length}
                      href="/provider-questions"
                      noun="provider question"
                      empty="Nothing waiting. Customer service creates Provider Questions from the patient page or a Zendesk ticket."
                    >
                      <QuestionList questions={questions.slice(0, ROWS)} viewerId={userId} />
                    </Capped>
                  }
                  mine={
                    <Capped
                      total={myQuestions.length}
                      href="/provider-questions"
                      noun="provider question"
                      empty="Nothing is assigned to you. Take a question from All and it becomes yours."
                    >
                      <QuestionList questions={myQuestions.slice(0, ROWS)} viewerId={userId} />
                    </Capped>
                  }
                />
              </section>
            </div>

            <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
              <ConsultationsCard rows={consultations} dayParam={dayParam} viewerEmail={email} />
              <ActionsCard actions={actions} />
            </aside>
          </div>
        </div>
      </main>
    </>
  )
}

function SectionHeading({
  id,
  title,
  count,
  note,
}: {
  id: string
  title: string
  count: number
  note: string | null
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-base font-medium text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {note && <span className="text-xs font-medium text-destructive">{note}</span>}
    </div>
  )
}

/** The first `ROWS` rows, then "See all N …" when there are more. */
function Capped({
  total,
  href,
  noun,
  empty,
  children,
}: {
  total: number
  href: string
  noun: string
  empty: string
  children: React.ReactNode
}) {
  if (total === 0) {
    return (
      <p className="rounded-xl border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    )
  }
  return (
    <>
      {children}
      {total > ROWS && (
        <Link
          href={href}
          className="mt-2 inline-flex items-center gap-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          See all {plural(total, noun)}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </>
  )
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function NoQueueAccess() {
  return (
    <>
      <PortalChrome />
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>You&rsquo;re signed in</CardTitle>
            <CardDescription>
              Your account can sign in to the provider portal, but lab reviews are limited to
              accounts with the provider or admin role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If you should have access, ask an administrator to add the provider role to your
              account.
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
