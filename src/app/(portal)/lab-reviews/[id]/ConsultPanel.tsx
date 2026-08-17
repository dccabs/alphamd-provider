'use client'

import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { consultLine, type ConsultRequest } from '@/lib/consultations/request'
import { upcomingCount, type Consultation } from '@/lib/labReviews/consultations'
import { shortDateTime } from '@/lib/labReviews/format'
import { ConsultDialog } from './ConsultDialog'

/**
 * The consultation this review is asking the patient to book.
 *
 * Reachable under every disposition, like `LabOrdersPanel`. Asking the patient in
 * is not only something a "Follow-up needed" review does: a dose change is worth
 * talking through, and a protocol continuing as designed is still a conversation
 * some patients want.
 *
 * One at a time. Two booking links for one review would have the patient book two
 * appointments for the same conversation, so choosing again edits the request
 * rather than adding to it.
 */

export function ConsultPanel({
  reviewId,
  patientEmail,
  patientStatusId,
  patientGender,
  consultations,
  request,
  onChange,
}: {
  /** Needed to mint the booking link, which is bound to this review's patient. */
  reviewId: string
  patientEmail: string | null
  /** `user_list.status`, which decides whether member follow-ups are suggested. */
  patientStatusId: number | null
  patientGender: string | null
  /** What the patient has already booked, so a second link is a deliberate act. */
  consultations: Consultation[]
  request: ConsultRequest | null
  onChange: (request: ConsultRequest | null) => void
}) {
  const [editing, setEditing] = useState(false)

  const upcoming = upcomingCount(consultations)

  return (
    // No heading: this sits inside a `ReviewStep`, which titles it.
    <div className="flex flex-col gap-2">
      {request ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2 rounded-lg border border-green-600 bg-green-50 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{consultLine(request)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {patientEmail ? `Booking link to ${patientEmail}` : 'No email address on file'}
              </div>
              {request.message.trim() && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  “{request.message.trim()}”
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="outline" size="xs" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" size="xs" onClick={() => onChange(null)}>
                Remove
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The booking link is reserved. It is emailed when the review is approved, not now.
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          {patientEmail
            ? 'The patient is not being asked to book a consultation.'
            : 'This patient has no email address on file, so an invitation cannot be sent.'}
        </p>
      )}

      {!request && (
        <div>
          <Button
            variant="outline"
            size="xs"
            disabled={!patientEmail}
            title={patientEmail ? undefined : 'This patient has no email address on file.'}
            onClick={() => setEditing(true)}
          >
            <CalendarPlus />
            Request a consultation
          </Button>
        </div>
      )}

      {/* Named here as well as in the dialog: a provider who never opens the dialog
          would otherwise send a second invitation to a patient who is already
          booked, which reads to them as the first one having failed. */}
      {upcoming > 0 && (
        <p className="text-xs text-amber-700">
          {upcoming === 1
            ? `This patient is already booked for ${shortDateTime(
                consultations.find((c) => c.outcome === 'scheduled')?.startsAt ?? null
              )}.`
            : `This patient already has ${upcoming} upcoming consultations.`}
        </p>
      )}

      {editing && (
        <ConsultDialog
          reviewId={reviewId}
          patientEmail={patientEmail}
          patientStatusId={patientStatusId}
          patientGender={patientGender}
          consultations={consultations}
          initial={request}
          onCancel={() => setEditing(false)}
          onConfirm={(next) => {
            onChange(next)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}
