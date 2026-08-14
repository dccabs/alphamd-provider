'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { eventTypesFor, type ConsultationEventType } from '@/lib/consultations/eventTypes'
import { upcomingCount, type Consultation } from '@/lib/labReviews/consultations'
import { shortDateTime } from '@/lib/labReviews/format'
import type { ConsultState } from '../state'

/**
 * Asking a patient to book a consultation.
 *
 * Already-booked upcoming appointments are shown first. A provider who cannot see
 * that the patient is booked for Thursday sends a second invitation, and the
 * patient reasonably reads that as "the first one did not work".
 *
 * The consultation types are ordered by what suits this patient rather than
 * filtered to it — `eventTypesFor` puts the appropriate ones first and keeps the
 * rest one click away. Patient status and recorded gender are both routinely stale
 * or blank, and a provider who knows the patient should not be blocked by a field
 * that disagrees.
 */

type Props = {
  patientEmail: string | null
  patientStatusId: number | null
  patientGender: string | null
  consultations: Consultation[]
  state: ConsultState
  pending: boolean
  onSubmit: (input: { eventTypeId: string; message: string }) => void
  onClose: () => void
}

export function RequestConsultPanel({
  patientEmail,
  patientStatusId,
  patientGender,
  consultations,
  state,
  pending,
  onSubmit,
  onClose,
}: Props) {
  const [eventTypeId, setEventTypeId] = useState('')
  const [message, setMessage] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [copied, setCopied] = useState(false)

  const { suggested, other } = useMemo(
    () => eventTypesFor({ statusId: patientStatusId, gender: patientGender }),
    [patientGender, patientStatusId]
  )

  const upcoming = consultations.filter((c) => c.outcome === 'scheduled')

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Request a consultation</h2>
          <p className="text-xs text-muted-foreground">
            {patientEmail
              ? `A single-use booking link is emailed to ${patientEmail}. It stops working once they book.`
              : 'This patient has no email address on file, so an invitation cannot be sent.'}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

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

      {state.status === 'sent' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-green-800">
            <Check className="size-3.5" />
            Booking link emailed to {state.sentTo}
          </span>
          {/* Shown because the link is single-use and already sent: if the patient
              says it never arrived, this is what saves burning a second one. */}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border bg-card px-2 py-1 text-xs">
              {state.bookingUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(state.bookingUrl)
                setCopied(true)
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {state.warning && <p className="text-xs text-amber-800">{state.warning}</p>}
        </div>
      ) : (
        <>
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
            <Textarea
              id="consult-message"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I would like to talk through your ferritin before we change anything…"
            />
          </div>

          {state.status === 'error' && (
            <p role="alert" className="text-xs text-destructive">
              {state.message}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Close
            </Button>
            <Button
              disabled={pending || !eventTypeId || !patientEmail}
              onClick={() => onSubmit({ eventTypeId, message })}
            >
              {pending ? 'Sending…' : 'Send booking link'}
            </Button>
          </div>
        </>
      )}
    </div>
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
