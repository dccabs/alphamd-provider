'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, Flame } from 'lucide-react'

import { setUrgentAction, takeProviderQuestionAction } from '@/app/(portal)/provider-questions/actions'
import { PatientStatusPill } from '@/components/patient-status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { isAged, questionRowMeta, type ProviderQuestionRow } from '@/lib/providerQuestions/queueRow'

/**
 * The Provider Question pile as a list of rows.
 *
 * Shared by the dashboard and `/provider-questions`. Each row answers: who is
 * the patient, is it Urgent, is it Aged, who has it (and who prescribes, which
 * is a different person), and how many Open questions this patient has.
 *
 * Take and Urgent live on the row because the pile is worked from the pile:
 * a provider should not have to open a question to claim it.
 */
export function QuestionList({
  questions,
  viewerId,
  numbered = false,
}: {
  questions: ProviderQuestionRow[]
  viewerId: string
  numbered?: boolean
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {questions.map((question, index) => (
        <QuestionRowItem
          key={question.id}
          question={question}
          viewerId={viewerId}
          position={numbered ? index + 1 : null}
        />
      ))}
    </ul>
  )
}

function QuestionRowItem({
  question,
  viewerId,
  position,
}: {
  question: ProviderQuestionRow
  viewerId: string
  position: number | null
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const mine = question.assignedTo === viewerId
  const open = question.status !== 'finished'
  const aged = isAged(question)

  const run = (action: () => Promise<{ status: string; message?: string; warning?: string }>) =>
    startTransition(async () => {
      setMessage(null)
      const result = await action()
      if (result.status === 'error') setMessage(result.message ?? 'Something went wrong.')
      else if (result.warning) setMessage(result.warning)
    })

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      {position !== null && (
        <span className="w-6 shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
          {position}
        </span>
      )}

      <Link
        href={`/provider-questions/${question.id}`}
        className="min-w-0 flex-1 rounded-md -m-1 p-1 hover:bg-muted/60"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{question.patientName}</span>
          <PatientStatusPill status={question.patientStatus} compact />

          {question.urgent && open && (
            <Badge variant="destructive" data-testid="urgent-badge">
              <Flame className="size-3" /> Urgent
            </Badge>
          )}
          {aged && (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-900"
              data-testid="aged-badge"
            >
              Aged
            </Badge>
          )}
          {question.status === 'in_progress' && (
            <Badge
              variant="outline"
              className={
                mine
                  ? 'border-sky-200 bg-sky-50 text-sky-900'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              }
            >
              {mine ? 'Mine' : 'In progress'}
            </Badge>
          )}
          {question.flags.map((flag) => (
            <Badge key={flag} variant="destructive">
              {flag}
            </Badge>
          ))}
        </span>

        <span className="mt-1 block text-sm text-foreground/90 line-clamp-2">
          {question.question}
        </span>

        {!open && question.resolution && (
          <span className="mt-1 block text-xs font-medium text-foreground/80">
            {question.resolution}
          </span>
        )}

        <span className="mt-1 block text-xs text-muted-foreground">
          {questionRowMeta(question).join(' · ')}
        </span>

        {message && <span className="mt-1 block text-xs text-destructive">{message}</span>}
      </Link>

      {open && (
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          {!mine && (
            <Button
              size="sm"
              variant={question.status === 'queued' ? 'default' : 'outline'}
              disabled={pending}
              onClick={() => run(() => takeProviderQuestionAction(question.id))}
              title={
                question.status === 'queued'
                  ? 'Take this question'
                  : `Take this question from ${question.assignedToName ?? 'its current provider'}`
              }
            >
              {question.status === 'queued' ? 'Take' : 'Take over'}
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            aria-pressed={question.urgent}
            onClick={() => run(() => setUrgentAction(question.id, !question.urgent))}
            title={question.urgent ? 'Clear Urgent' : 'Mark Urgent'}
            className={question.urgent ? 'text-destructive' : 'text-muted-foreground'}
          >
            <Flame className="size-3" />
            {question.urgent ? 'Clear urgent' : 'Urgent'}
          </Button>
        </span>
      )}

      {!open && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    </li>
  )
}
