'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import { eventTypesFor, type ConsultationEventType } from '@/lib/consultations/eventTypes'
import { consultLine, needsLink, type ConsultRequest } from '@/lib/consultations/request'
import { upcomingCount, type Consultation } from '@/lib/labReviews/consultations'
import { shortDateTime } from '@/lib/labReviews/format'
import { mintConsultLinkAction } from '../actions'

/**
 * Choosing the consultation the patient will be asked to book.
 *
 * ## Confirming mints a link; it does not invite
 *
 * Confirming does call Calendly, for the single-use booking link, and hands that
 * back to the flyout to be saved into `lab_reviews.draft`. Nothing is *sent*: the
 * email asking the patient to come in goes out when the review is approved, the
 * same deferral as a lab order and for the same reason.
 *
 * The link is minted here rather than at approval so that the one step depending on
 * a third party fails somewhere recoverable — a message in this dialog and another
 * attempt — instead of after the review row has been flipped to `finished`, where
 * it could only be reported as a warning about an invitation that never went out.
 *
 * It is never displayed. Approving is still the only thing that tells the patient
 * anything, and a link on screen beforehand is a link that can be sent out of band
 * from a review nobody has confirmed.
 *
 * The types are ordered by what suits this patient rather than filtered to it.
 * `eventTypesFor` puts the appropriate ones first and keeps the rest one click
 * away, because patient status and recorded gender are both routinely stale or
 * blank and a provider who knows the patient should not be blocked by a field that
 * disagrees.
 *
 * Appointments the patient has already booked are shown at the top. Without them a
 * provider cannot see that the patient is booked for Thursday, and a second
 * invitation reads to the patient as "the first one did not work".
 */

type Props = {
  reviewId: string
  patientEmail: string | null
  patientStatusId: number | null
  patientGender: string | null
  consultations: Consultation[]
  /** A request already attached to this review, when reopening to edit it. */
  initial: ConsultRequest | null
  onCancel: () => void
  onConfirm: (request: ConsultRequest) => void
}

export function ConsultDialog({
  reviewId,
  patientEmail,
  patientStatusId,
  patientGender,
  consultations,
  initial,
  onCancel,
  onConfirm,
}: Props) {
  const [eventTypeId, setEventTypeId] = useState(initial?.eventTypeId ?? '')
  const [message, setMessage] = useState(initial?.message ?? '')
  const [showOther, setShowOther] = useState(false)
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { suggested, other } = useMemo(
    () => eventTypesFor({ statusId: patientStatusId, gender: patientGender }),
    [patientGender, patientStatusId]
  )

  const upcoming = consultations.filter((c) => c.outcome === 'scheduled')

  /**
   * A link is minted per type, not per confirmation. Reopening to reword the
   * message keeps the link already held: it is bound to the event type and nothing
   * else, so re-minting would leave an orphan behind for no gain.
   */
  const confirm = async () => {
    if (initial && initial.eventTypeId === eventTypeId && !needsLink(initial)) {
      onConfirm({ ...initial, message })
      return
    }

    setError(null)
    setMinting(true)
    const link = await mintConsultLinkAction(reviewId, eventTypeId)
    setMinting(false)

    if (!link.ok) {
      setError(link.error)
      return
    }

    onConfirm({
      eventTypeId,
      message,
      bookingUrl: link.bookingUrl,
      expiresAt: link.expiresAt,
    })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[90dvh] w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pb-4 pr-8">
          <DialogTitle>
            {initial ? 'Edit the consultation request' : 'Request a consultation'}
          </DialogTitle>
          <DialogDescription>
            {patientEmail
              ? `A single-use booking link is emailed to ${patientEmail} when you approve the review. It stops working once they book.`
              : 'This patient has no email address on file, so an invitation cannot be sent.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 border-t pt-4">
          {upcoming.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <span className="text-[13px] font-semibold text-amber-900">
                {upcomingCount(consultations) === 1
                  ? 'This patient already has an upcoming consultation'
                  : 'This patient already has upcoming consultations'}
              </span>
              <ul className="flex flex-col gap-0.5 text-xs text-amber-900">
                {upcoming.map((consultation) => (
                  <li key={consultation.id}>
                    {shortDateTime(consultation.startsAt)}
                    {consultation.name ? ` — ${consultation.name}` : ''}
                    {consultation.providerName ? ` with ${consultation.providerName}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold tracking-wider text-muted-foreground">
              CONSULTATION TYPE
            </span>
            <ul className="flex flex-col gap-1">
              {suggested.map((type) => (
                <EventTypeOption
                  key={type.id}
                  type={type}
                  selected={eventTypeId === type.id}
                  onSelect={() => setEventTypeId(type.id)}
                />
              ))}
            </ul>

            {showOther ? (
              <ul className="flex flex-col gap-1">
                <li className="pt-1 text-xs text-muted-foreground">
                  Types that do not match this patient’s status or recorded gender:
                </li>
                {other.map((type) => (
                  <EventTypeOption
                    key={type.id}
                    type={type}
                    selected={eventTypeId === type.id}
                    onSelect={() => setEventTypeId(type.id)}
                  />
                ))}
              </ul>
            ) : (
              <button
                type="button"
                onClick={() => setShowOther(true)}
                className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Show {other.length} other consultation types
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consult-message" className="text-xs text-muted-foreground">
              Message to the patient (optional). Replaces the default line about going over their
              results.
            </Label>
            <DictationTextarea
              id="consult-message"
              rows={3}
              value={message}
              onValueChange={setMessage}
              placeholder="I would like to talk through your ferritin before we change anything…"
            />
          </div>

          {eventTypeId && (
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 px-3 py-2.5">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                WILL BE RECORDED AS
              </span>
              <p className="text-xs leading-relaxed">{consultLine({ eventTypeId })}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 sm:justify-between">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {error ??
              (patientEmail
                ? ''
                : 'Add an email address to this patient’s record first.')}
          </p>
          <span className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onCancel} disabled={minting}>
              Cancel
            </Button>
            <Button
              onClick={confirm}
              disabled={!eventTypeId || !patientEmail || minting}
              title={eventTypeId ? undefined : 'Choose a consultation type.'}
            >
              {minting ? 'Reserving…' : initial ? 'Save request' : 'Add to review'}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EventTypeOption({
  type,
  selected,
  onSelect,
}: {
  type: ConsultationEventType
  selected: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <label
        className={[
          'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
          selected ? 'border-foreground bg-muted' : 'border-border hover:bg-muted/60',
        ].join(' ')}
      >
        <input
          type="radio"
          name="consult-event-type"
          checked={selected}
          onChange={onSelect}
          className="mt-0.5 size-3.5"
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{type.name}</span>
          <span className="block text-xs text-muted-foreground">
            {type.duration} minutes
            {type.namedProvider ? ` · ${type.namedProvider}` : ''}
          </span>
        </span>
      </label>
    </li>
  )
}
