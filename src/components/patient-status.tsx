import { shortStatus, statusTone } from '@/lib/labReviews/format'

/**
 * The patient's `user_statuses` label as a pill.
 *
 * One component for the review header and the queue rows so a provider reads the
 * same words and the same colour in both places. Only a status that genuinely
 * says "Active" is painted green — see `statusTone` for why that matters.
 *
 * `compact` is for a row in a list: it shortens the label (the stored ones run
 * long) and puts the full one in a `title`.
 */
export function PatientStatusPill({
  status,
  compact = false,
}: {
  status: string | null | undefined
  compact?: boolean
}) {
  if (!status?.trim()) return null

  const label = compact ? shortStatus(status) : status
  const active = statusTone(status) === 'active'

  return (
    <span
      title={compact ? status : undefined}
      className={[
        'inline-flex min-w-0 items-center gap-1.5 rounded-full border text-xs font-semibold',
        compact ? 'px-2 py-0.5' : 'px-2.5 py-1',
        active
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'bg-muted text-muted-foreground',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          active ? 'bg-green-500' : 'bg-muted-foreground/60'
        }`}
      />
      <span className={compact ? 'max-w-[15rem] truncate' : undefined}>{label}</span>
    </span>
  )
}
