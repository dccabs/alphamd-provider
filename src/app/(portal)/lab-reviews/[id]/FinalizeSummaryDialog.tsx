'use client'

import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FLAG_LABELS, PATIENT_STATUS_LABELS } from '@/lib/labReviews/clinicalIds'
import { planCompletion, reviewAudiences } from '@/lib/labReviews/completion'
import {
  DISPOSITION_LABELS,
  FOLLOW_UP_LABELS,
  type ReviewDraft,
} from '@/lib/labReviews/reviewDraft'

/**
 * The last screen before a review is finished: everything it will do, in one
 * place, read-only.
 *
 * Finishing is the widest write in the portal — a note onto the chart, flags on
 * and off, sometimes the patient's status, and a message to the patient — and
 * until now the provider committed all of it from a button with no preview. The
 * three destination cards are the substance: the same words, going to three
 * different readers, is the thing that is easy to get subtly wrong and
 * impossible to see while writing them in separate boxes.
 *
 * Every string here comes from `planCompletion` and `reviewAudiences` rather than
 * being composed for display, so what is approved is what gets written.
 *
 * **Precondition:** `validateCompletion(draft)` must be empty. Both functions
 * throw without a disposition, which is deliberate — a summary of an incoherent
 * review would be a summary of something that cannot happen.
 */

export function FinalizeSummaryDialog({
  draft,
  patientName,
  providerName,
  onEdit,
  onApprove,
}: {
  draft: ReviewDraft
  patientName: string
  /** The name the chart note will be signed with. */
  providerName: string
  onEdit: () => void
  /** What approving does, or null while finishing is switched off — in which case
   *  the button says plainly that it does nothing rather than pretending. */
  onApprove: (() => void) | null
}) {
  const [pressed, setPressed] = useState(false)

  const plan = planCompletion(draft, providerName)
  const audiences = reviewAudiences(draft, providerName)
  const { disposition, doseChanges, newMedications, followUpKinds } = plan.detail

  const effects = [
    ...plan.removeFlagIds.map((id) => `Clears the "${FLAG_LABELS[id] ?? id}" flag.`),
    ...plan.addFlagIds.map((id) => `Adds the "${FLAG_LABELS[id] ?? id}" flag.`),
    plan.patientStatusId === null
      ? null
      : `Patient status becomes "${PATIENT_STATUS_LABELS[plan.patientStatusId] ?? plan.patientStatusId}".`,
  ].filter(Boolean)

  return (
    <Dialog open onOpenChange={(next) => !next && onEdit()}>
      <DialogContent className="max-h-[90dvh] w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pb-4 pr-8">
          <DialogTitle>Before you finish — {patientName}</DialogTitle>
          <DialogDescription>
            Nothing has been submitted. This is what finishing the review would send and record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 border-t pt-4">
          <Section title="DECISION">
            <ul className="flex flex-col gap-1 text-[13px]">
              <li>{DISPOSITION_LABELS[disposition]}</li>
              {followUpKinds.length > 0 && disposition === 'follow_up_needed' && (
                <li className="text-muted-foreground">
                  Follow-up: {followUpKinds.map((kind) => FOLLOW_UP_LABELS[kind]).join(', ')}
                </li>
              )}
              {doseChanges.map((change) => (
                <li key={`dose-${change.medicationId}-${change.medication}`}>
                  {change.medication} — {change.from ? `${change.from} → ` : ''}
                  <span className="font-semibold">{change.value}</span>
                </li>
              ))}
              {newMedications.map((med) => (
                <li key={`med-${med.medicationId}-${med.name}`}>
                  New: {med.name}
                  {med.dose ? ` — ${med.dose}` : ''}
                </li>
              ))}
            </ul>
          </Section>

          {/* Named by reader rather than by field, because the chart card below
              contains the other two: the note records what the patient was told
              and what customer service was handed. */}
          <Destination
            title="THE PATIENT RECEIVES"
            text={audiences.patient}
            empty="Nothing written — the patient will not hear from you about this review."
          />

          <Destination
            title="CUSTOMER SERVICE RECEIVES"
            text={audiences.customerService}
            empty="Nothing for customer service."
          />

          {/* Never empty: the note always opens with who reviewed and what they
              decided, which is the minimum a chart entry has to say. */}
          <Destination title="THE CHART RECORDS" text={audiences.chart} />

          <Section title="IN THE QUEUE">
            <p className="text-[13px]">{plan.resolution}</p>
          </Section>

          {effects.length > 0 && (
            <Section title="WHAT ELSE HAPPENS">
              <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
                {effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <DialogFooter className="mt-4 items-center">
          {!onApprove && (
            <p aria-live="polite" className="mr-auto text-xs text-muted-foreground">
              {pressed
                ? 'Nothing happened. Finishing is switched off, so this review is still open.'
                : 'Approve does nothing yet — no note is written and nothing is sent.'}
            </p>
          )}
          <Button variant="outline" onClick={onEdit}>
            Go back and edit
          </Button>
          <Button onClick={() => (onApprove ? onApprove() : setPressed(true))}>Approve</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold tracking-wider text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** One reader's text, verbatim. The empty state says who will not hear anything
 *  rather than leaving a blank panel that reads as a rendering failure. */
function Destination({ title, text, empty }: { title: string; text: string; empty?: string }) {
  return (
    <Section title={title}>
      {text ? (
        <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
          {text}
        </p>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          {empty}
        </p>
      )}
    </Section>
  )
}
