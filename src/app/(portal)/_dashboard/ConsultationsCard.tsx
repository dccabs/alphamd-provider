'use client'

import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, ExternalLink, Video } from 'lucide-react'

import { adminAppointmentsUrl, adminPatientUrl, meetJoinUrl } from '@/lib/adminLinks'
import {
  consultationType,
  formatClock,
  formatDayHeading,
  localDayKey,
  onLocalDay,
  shiftDayKey,
} from '@/lib/consultations/day'
import type { ProviderConsultation } from '@/lib/consultations/providerDay'
import { PatientStatusPill } from '@/components/patient-status'
import { Badge } from '@/components/ui/badge'

/**
 * The dashboard's consultations for one day, in the provider's timezone.
 *
 * A client component on purpose: "today" and the clock times are decided in the
 * browser. The server handed over a window of rows; this keeps the ones on the
 * selected local day. Paging forward writes `?day=` so a reload keeps the day;
 * paging back stops at today. Patients open in the admin chart and Join goes
 * through the admin Meet redirect, because consults are not run here yet.
 */
export function ConsultationsCard({
  rows,
  dayParam,
  viewerEmail,
}: {
  rows: ProviderConsultation[]
  dayParam: string | null
  viewerEmail: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const todayKey = localDayKey(new Date())
  const requested = dayParam ?? todayKey
  const dayKey = requested < todayKey ? todayKey : requested
  const isToday = dayKey === todayKey
  const heading = formatDayHeading(dayKey, todayKey)

  const go = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === todayKey) params.delete('day')
      else params.set('day', next)
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname)
    },
    [pathname, router, searchParams, todayKey]
  )

  const day = useMemo(() => onLocalDay(rows, dayKey), [rows, dayKey])

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Consultations
          <span className="ml-1.5 text-muted-foreground tabular-nums">{day.length}</span>
        </h2>
        <div className="inline-flex items-center gap-0.5">
          <NavButton
            onClick={() => go(shiftDayKey(dayKey, -1))}
            disabled={isToday}
            label="Previous day"
            title={isToday ? 'Today is as far back as the dashboard goes' : 'Previous day'}
          >
            <ChevronLeft className="size-3.5" />
          </NavButton>
          <button
            type="button"
            onClick={() => go(todayKey)}
            disabled={isToday}
            className={`min-w-16 text-center text-xs font-medium tabular-nums ${
              isToday ? 'cursor-default' : 'hover:underline'
            }`}
            title={isToday ? undefined : 'Back to today'}
          >
            {heading}
          </button>
          <NavButton onClick={() => go(shiftDayKey(dayKey, 1))} label="Next day" title="Next day">
            <ChevronRight className="size-3.5" />
          </NavButton>
        </div>
      </div>

      <div className="mt-3">
        {day.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {isToday ? 'No consultations today.' : `Nothing booked ${heading.toLowerCase() === 'tomorrow' ? 'tomorrow' : heading}.`}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {day.map((c) => (
              <ConsultationRow key={c.id} c={c} viewerEmail={viewerEmail} />
            ))}
          </ol>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <a
          href={adminAppointmentsUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          All appointments
          <ExternalLink className="size-3" />
        </a>
      </div>
    </section>
  )
}

function NavButton({
  onClick,
  disabled,
  label,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="rounded-md p-0.5 hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function ConsultationRow({ c, viewerEmail }: { c: ProviderConsultation; viewerEmail: string }) {
  const done = c.outcome !== 'scheduled'

  return (
    <li className={`rounded-lg border bg-card px-3 py-2 ${done ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{formatClock(c.startsAt)}</span>
        {done ? (
          <Badge variant="secondary">
            {c.outcome === 'cancelled' ? 'Cancelled' : c.outcome === 'no_show' ? 'No-show' : 'Past'}
          </Badge>
        ) : c.joinUrl ? (
          <a
            href={meetJoinUrl(c.joinUrl, viewerEmail)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background hover:bg-foreground/85"
          >
            <Video className="size-3" />
            Join
          </a>
        ) : (
          <span className="text-xs text-muted-foreground" title="Calendly did not record a meeting link">
            No link
          </span>
        )}
      </div>
      <div className="mt-1">
        {c.patientId ? (
          <a
            href={adminPatientUrl(c.patientId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:underline"
            title="Open chart in the admin app"
          >
            {c.patientName}
          </a>
        ) : (
          <span className="text-sm font-medium">{c.patientName}</span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{consultationType(c.name)}</span>
        <PatientStatusPill status={c.patientStatus} compact />
      </div>
    </li>
  )
}
