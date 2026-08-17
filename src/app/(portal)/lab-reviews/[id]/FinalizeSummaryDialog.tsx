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
import { consultLine } from '@/lib/consultations/request'
import { orderLine, scheduledDateFor } from '@/lib/labOrders/order'
import { FLAG_LABELS, PATIENT_STATUS_LABELS } from '@/lib/labReviews/clinicalIds'
import { planCompletion, reviewAudiences } from '@/lib/labReviews/completion'
import { shortDate } from '@/lib/labReviews/format'
import { DISPOSITION_LABELS, type ReviewDraft } from '@/lib/labReviews/reviewDraft'

/**
 * The last screen before a review is finished: everything it will do, in one
 * place, read-only.
 *
 * Finishing is the widest write in the portal — a note onto the chart, flags on
 * and off, sometimes the patient's status, a message to the patient, and any lab
 * order or consultation invitation composed in the review — and until now the
 * provider committed all of it from a button with no preview. The
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
  patientEmail,
  providerName,
  onEdit,
  onApprove,
}: {
  draft: ReviewDraft
  patientName: string
  /** Where a consultation invitation would be sent, named here because approving
   *  is what sends it. */
  patientEmail: string | null
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
  const { disposition, doseChanges, newMedications, labOrders, consultation } = plan.detail

  const effects = [
    ...plan.removeFlagIds.map((id) => `Clears the "${FLAG_LABELS[id] ?? id}" flag.`),
    ...plan.addFlagIds.map((id) => `Adds the "${FLAG_LABELS[id] ?? id}" flag.`),
    plan.patientStatusId === null
      ? null
      : `Patient status becomes "${PATIENT_STATUS_LABELS[plan.patientStatusId] ?? plan.patientStatusId}".`,
    // The one effect that leaves the building. Named apart from the order itself
    // because approving is what sends it, and when it arrives is the part a
    // provider is deciding about.
    ...labOrders.map((order) => {
      if (order.timing === 'now') {
        return 'The lab order is placed and emailed to the patient within a few minutes.'
      }
      const date = scheduledDateFor(order.timing, order.customDate)
      return `The patient is emailed a heads-up now, and the order itself on ${
        date ? shortDate(date.toISOString()) : 'the date on the order'
      }.`
    }),
    // Reserved when the provider attached it, so approving only sends it. Said
    // plainly because "a link is created" would suggest it could still fail here.
    consultation
      ? `The booking link already reserved for this review is emailed to ${patientEmail ?? 'the patient'}, and stops working once they book.`
      : null,
  ].filter(Boolean)

  return (
    <Dialog open onOpenChange={(next) => !next && onEdit()}>
      {/* 4xl, the same cap as every other dialog in the review. The blocks here are
          long — a whole patient message, a whole chart note — and the width buys
          fewer wrapped lines, so less of the screen is spent scrolling. */}
      <DialogContent className="max-h-[90dvh] w-full gap-0 overflow-y-auto sm:max-w-4xl">
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

          {/* Its own section rather than a line in the decision, because it is
              the one thing here that reaches the patient's wallet: they are
              emailed a requisition and pay for whatever AlphaMD is not covering. */}
          {labOrders.length > 0 && (
            <Section title="LABS TO BE ORDERED">
              <ul className="flex flex-col gap-1.5">
                {labOrders.map((order, index) => (
                  <li
                    key={index}
                    className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed"
                  >
                    <span className="font-medium">{orderLine(order)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {[
                        order.diagnosisCodes.join(', ') || 'no diagnosis code',
                        order.requiredCodes.length
                          ? `${order.requiredCodes.length} the patient cannot remove`
                          : null,
                        order.compedCodes.length
                          ? `${order.compedCodes.length} covered by AlphaMD`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Also its own section: it is the other thing here that asks something
              of the patient, and the type decides how long they get and with
              whom — neither of which is obvious from "consultation requested". */}
          {consultation && (
            <Section title="CONSULTATION">
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
                <span className="font-medium">{consultLine(consultation)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Booking link reserved, to {patientEmail ?? 'no email address on file'}
                </span>
                {consultation.message && (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed">
                    “{consultation.message}”
                  </p>
                )}
              </div>
            </Section>
          )}

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
                ? 'Nothing happened. Finishing is switched off, so this review is still open, no labs were ordered and no invitation was sent.'
                : 'Approve does nothing yet — no note is written, no labs are ordered, no consultation invitation is sent and nothing reaches the patient.'}
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
