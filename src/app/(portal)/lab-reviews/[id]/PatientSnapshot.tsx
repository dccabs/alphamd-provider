'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CONSULTATION_OUTCOME_LABELS,
  featuredConsultation,
  type Consultation,
} from '@/lib/labReviews/consultations'
import { shortDate, shortDateTime } from '@/lib/labReviews/format'
import {
  expirationLabel,
  medicationSummaryLine,
  orderMedications,
} from '@/lib/labReviews/medications'
import type { Medication, Order } from './types'

/**
 * What the patient is on, what was last sent, and what is next — in the header,
 * where it is read before the labs rather than found behind a tab.
 *
 * These three were tabs in the right rail. A provider reads labs against the
 * current regimen, so making them a click away made the header describe who the
 * patient is while leaving out what is being done about it. Medications collapse
 * to one line — names, and a weekly dose when it is known — because the full
 * sigs and expirations are the history, not the glance. Orders and consultations
 * show only the newest, and every history stays one button away.
 */
export function PatientSnapshot({
  medications,
  orders,
  consultations,
}: {
  medications: Medication[]
  orders: Order[]
  consultations: Consultation[]
}) {
  const [showOrders, setShowOrders] = useState(false)
  const [showConsultations, setShowConsultations] = useState(false)
  const [showMedications, setShowMedications] = useState(false)

  // Both lists arrive newest first, so the head of the orders list is the last
  // one sent. Consultations are picked rather than taken, because an upcoming
  // booking matters more than the newest row — see `featuredConsultation`.
  const lastOrder = orders[0] ?? null
  const consultation = featuredConsultation(consultations)

  return (
    <div className="grid gap-x-6 gap-y-4 border-t px-5 py-4 md:grid-cols-3">
      <Column
        label="Medications"
        action={
          medications.length > 0 && (
            <HistoryButton onClick={() => setShowMedications(true)}>Details</HistoryButton>
          )
        }
      >
        <MedicationSummary medications={medications} />
      </Column>

      <Column
        label="Last order"
        action={
          orders.length > 1 && (
            <HistoryButton onClick={() => setShowOrders(true)}>
              See all {orders.length} orders
            </HistoryButton>
          )
        }
      >
        {lastOrder ? <LastOrder order={lastOrder} /> : <Nothing>No orders on record.</Nothing>}
      </Column>

      <Column
        label={consultation?.outcome === 'scheduled' ? 'Next consultation' : 'Last consultation'}
        action={
          consultations.length > 1 && (
            <HistoryButton onClick={() => setShowConsultations(true)}>
              See all {consultations.length} consultations
            </HistoryButton>
          )
        }
      >
        {consultation ? (
          <FeaturedConsultation consultation={consultation} />
        ) : (
          <Nothing>No consultations booked.</Nothing>
        )}
      </Column>

      {showMedications && (
        <HistoryDialog
          title="Medications"
          description="Every prescription on this patient's record, with the full instructions and expiration."
          onClose={() => setShowMedications(false)}
        >
          <MedicationHistory medications={medications} />
        </HistoryDialog>
      )}

      {showOrders && (
        <HistoryDialog
          title="Order history"
          description="Every order on this patient's record, newest first."
          onClose={() => setShowOrders(false)}
        >
          <OrdersList orders={orders} />
        </HistoryDialog>
      )}

      {showConsultations && (
        <HistoryDialog
          title="Consultations"
          description="Every consultation booked for this patient, newest first."
          onClose={() => setShowConsultations(false)}
        >
          <ConsultationsList consultations={consultations} />
        </HistoryDialog>
      )}
    </div>
  )
}

function Column({
  label,
  action,
  children,
}: {
  label: string
  /** `false` as well as undefined, so a caller can inline a condition. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
          {label}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function HistoryButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}

function MedicationSummary({ medications }: { medications: Medication[] }) {
  if (!medications.length) return <Nothing>No medications on record.</Nothing>

  const line = medicationSummaryLine(medications)
  if (!line) return <Nothing>No active medications.</Nothing>

  return <p className="text-[13px] leading-snug">{line}</p>
}

/**
 * Every medication, active ones first and testosterone at the top, each with the
 * date it runs out.
 *
 * Expired rows are dimmed *and* badged: dimming alone would make "no longer
 * taking this" a colour, which is exactly the distinction a provider cannot
 * afford to miss. Those rows show the bare date after the badge, which already
 * supplies the verb; an active one is prefixed with "Expires" so a future date
 * cannot be misread as the day it lapsed.
 */
function MedicationHistory({ medications }: { medications: Medication[] }) {
  const ordered = orderMedications(medications).sort(
    (a, b) => Number(b.active) - Number(a.active)
  )

  return (
    <ul className="flex flex-col">
      {ordered.map((med) => {
        const expiration = expirationLabel(med.expiration)
        return (
          <li key={med.id} className="flex flex-col gap-1 border-b px-5 py-3 last:border-b-0">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className={med.active ? 'text-[13px] font-semibold' : 'text-[13px] text-muted-foreground'}>
                {med.name}
              </span>
              {!med.active && <Badge variant="secondary">Expired</Badge>}
              {expiration && (
                <span className="text-xs text-muted-foreground">
                  {med.active ? `Expires ${expiration}` : expiration}
                </span>
              )}
            </div>
            {med.dosage && (
              <p className="text-[13px] leading-relaxed text-muted-foreground">{med.dosage}</p>
            )}
            {med.pharmacy && (
              <p className="text-xs text-muted-foreground">{med.pharmacy}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function orderMeta(order: Order): string {
  return (
    [
      order.orderDate ? shortDate(order.orderDate) : null,
      order.pharmacy,
      order.orderNumber ? `#${order.orderNumber}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'Order'
  )
}

function LastOrder({ order }: { order: Order }) {
  const first = order.contents[0] ?? null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{orderMeta(order)}</span>
        {order.status && <Badge variant="secondary">{order.status}</Badge>}
      </div>

      {first ? (
        <p className="text-[13px] leading-snug">
          {first.name && <span className="font-semibold">{first.name}</span>}
          {first.name && ' — '}
          <span className="text-muted-foreground">{first.detail}</span>
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground italic">No contents recorded.</p>
      )}
    </div>
  )
}

function FeaturedConsultation({ consultation }: { consultation: Consultation }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold">{consultation.name ?? 'Consultation'}</span>
        <OutcomeChip outcome={consultation.outcome} />
      </div>
      <span className="text-xs text-muted-foreground">
        {[shortDateTime(consultation.startsAt), consultation.timezone, consultation.providerName]
          .filter(Boolean)
          .join(' · ') || 'No date recorded'}
      </span>
    </div>
  )
}

/** `unrecorded` is deliberately absent: it is the majority of rows, and a "Past"
 *  chip on every line would be noise. The others each say something. */
const CONSULTATION_OUTCOME_STYLE: Partial<Record<Consultation['outcome'], string>> = {
  scheduled: 'border-blue-200 bg-blue-50 text-blue-700',
  attended: 'border-green-200 bg-green-50 text-green-700',
  no_show: 'border-amber-200 bg-amber-50 text-amber-800',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

function OutcomeChip({ outcome }: { outcome: Consultation['outcome'] }) {
  const style = CONSULTATION_OUTCOME_STYLE[outcome]
  if (!style) return null

  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${style}`}
    >
      {CONSULTATION_OUTCOME_LABELS[outcome].toUpperCase()}
    </span>
  )
}

/** Styled like the recorded-values dialog on this screen rather than as its own
 *  thing, since both are "the full list behind a summary". */
function HistoryDialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string
  description: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[80dvh] w-full gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="border-t">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What was ordered leads, because that is what a provider reading labs needs —
 * the date and pharmacy are context for it. Order contents are freeform staff
 * text, so a line is only ever emphasised when it split cleanly into a name and
 * a sig; see `orderContentLines`.
 */
function OrdersList({ orders }: { orders: Order[] }) {
  return (
    <ul className="flex flex-col">
      {orders.map((order) => (
        <li
          key={order.id}
          className="flex items-start justify-between gap-3 border-b px-5 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{orderMeta(order)}</div>

            {order.contents.length ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {order.contents.map((line, i) => (
                  <li key={i} className="text-[13px] leading-relaxed">
                    {line.name && <span className="font-semibold">{line.name}</span>}
                    {line.name && ' — '}
                    <span className="text-muted-foreground">{line.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground italic">
                No contents recorded on this order.
              </p>
            )}
          </div>
          {order.status && <Badge variant="secondary">{order.status}</Badge>}
        </li>
      ))}
    </ul>
  )
}

function ConsultationsList({ consultations }: { consultations: Consultation[] }) {
  return (
    <ul className="flex flex-col">
      {consultations.map((consultation) => (
        <li
          key={consultation.id}
          className="flex items-start justify-between gap-3 border-b px-5 py-3 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              {consultation.name ?? 'Consultation'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {[
                shortDateTime(consultation.startsAt),
                consultation.timezone,
                consultation.providerName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <OutcomeChip outcome={consultation.outcome} />
        </li>
      ))}
    </ul>
  )
}
