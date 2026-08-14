'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  DIAGNOSIS_CODES,
  LAB_PRESETS,
  LAB_TESTS,
  PHLEBOTOMY_CODE,
  isRestrictedState,
} from '@/lib/labOrders/catalog'
import {
  EMPTY_ORDER,
  ORDER_TIMINGS,
  ORDER_TIMING_LABELS,
  applyPreset,
  scheduledDateFor,
  validateOrder,
  type LabOrder,
} from '@/lib/labOrders/order'
import { shortDate } from '@/lib/labReviews/format'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'

/**
 * Ordering labs from inside a review.
 *
 * Structured as one screen rather than the main app's four-step wizard. A provider
 * looking at abnormal results already knows what they want to order and on what
 * interval; stepping them through date, then tests, then confirmation adds clicks
 * without adding a decision. The presets do the work the wizard's steps were
 * carrying.
 *
 * Existing orders are shown at the top, not behind a step. The reason is
 * clinical: without them a provider cannot see that a redraw was already
 * scheduled last week, and a duplicate order means the patient pays twice and
 * visits a lab twice.
 */

type Props = {
  patientState: string | null
  providers: LabProviderOption[]
  existing: ScheduledLabOrder[]
  pending: boolean
  onSubmit: (order: LabOrder) => void
  onCancel: (scheduledId: string) => void
  onClose: () => void
}

const STATUS_TONE: Record<string, string> = {
  pending: 'border-blue-200 bg-blue-50 text-blue-700',
  sent: 'border-green-200 bg-green-50 text-green-700',
  expired: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Scheduled',
  sent: 'Sent to patient',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

export function OrderLabsPanel({
  patientState,
  providers,
  existing,
  pending,
  onSubmit,
  onCancel,
  onClose,
}: Props) {
  const [order, setOrder] = useState<LabOrder>(() => ({
    ...EMPTY_ORDER,
    // With one provider on file there is no decision to make.
    providerId: providers.length === 1 ? providers[0].id : '',
  }))
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)

  const restricted = isRestrictedState(patientState)
  const problems = validateOrder(order, patientState)
  const scheduledDate = scheduledDateFor(order.timing, order.customDate)
  const pendingExisting = existing.filter((e) => e.status === 'pending')

  const toggleTest = (code: string) =>
    setOrder((prev) => {
      const selected = prev.testCodes.includes(code)
      const testCodes = selected
        ? prev.testCodes.filter((c) => c !== code)
        : [...prev.testCodes, code]

      return {
        ...prev,
        testCodes,
        // Deselecting a test must not leave it marked required or comped, or the
        // payload would claim a flag on a test nobody ordered.
        requiredCodes: prev.requiredCodes.filter((c) => testCodes.includes(c)),
        compedCodes: prev.compedCodes.filter((c) => testCodes.includes(c)),
      }
    })

  const toggleFlag = (field: 'requiredCodes' | 'compedCodes', code: string) =>
    setOrder((prev) => ({
      ...prev,
      [field]: prev[field].includes(code)
        ? prev[field].filter((c) => c !== code)
        : [...prev[field], code],
    }))

  const toggleDiagnosis = (code: string) =>
    setOrder((prev) => ({
      ...prev,
      diagnosisCodes: prev.diagnosisCodes.includes(code)
        ? prev.diagnosisCodes.filter((c) => c !== code)
        : [...prev.diagnosisCodes, code],
    }))

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Order labs</h2>
          <p className="text-xs text-muted-foreground">
            The patient is emailed an order they can take to any lab. An order placed now goes out
            within a few minutes.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>

      {existing.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold tracking-wider text-muted-foreground">
            ALREADY ORDERED
          </span>
          <ul className="flex flex-col divide-y rounded-lg border">
            {existing.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span
                  className={`rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${
                    STATUS_TONE[entry.status] ?? STATUS_TONE.expired
                  }`}
                >
                  {(STATUS_LABELS[entry.status] ?? entry.status).toUpperCase()}
                </span>
                <span className="text-[13px] font-medium">
                  {entry.scheduledDate ? shortDate(entry.scheduledDate) : 'No date'}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {entry.testNames.join(', ') || 'No tests recorded'}
                </span>
                {entry.status === 'pending' &&
                  (confirmCancel === entry.id ? (
                    <span className="flex items-center gap-1.5">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          setConfirmCancel(null)
                          onCancel(entry.id)
                        }}
                      >
                        Cancel it
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => setConfirmCancel(null)}
                      >
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setConfirmCancel(entry.id)}
                    >
                      Cancel
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
          {pendingExisting.length > 0 && (
            <p className="text-xs text-amber-700">
              {pendingExisting.length === 1
                ? 'This patient already has a scheduled lab order.'
                : `This patient already has ${pendingExisting.length} scheduled lab orders.`}{' '}
              Cancel it first unless you mean to order twice.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">WHEN</span>
        <div className="flex flex-wrap gap-1.5">
          {ORDER_TIMINGS.map((timing) => (
            <button
              key={timing}
              type="button"
              onClick={() => setOrder((prev) => ({ ...prev, timing }))}
              className={[
                'rounded-lg border px-2.5 py-1.5 text-xs font-medium',
                order.timing === timing
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border hover:bg-muted',
              ].join(' ')}
            >
              {ORDER_TIMING_LABELS[timing]}
            </button>
          ))}
        </div>
        {order.timing === 'custom' && (
          <input
            type="date"
            value={order.customDate}
            onChange={(e) => setOrder((prev) => ({ ...prev, customDate: e.target.value }))}
            aria-label="Date these labs should be sent"
            className="h-8 w-44 rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        )}
        {scheduledDate && order.timing !== 'now' && (
          <p className="text-xs text-muted-foreground">
            The patient is emailed the order on {shortDate(scheduledDate.toISOString())}, and a
            heads-up now.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="order-provider" className="text-xs font-bold tracking-wider text-muted-foreground">
          ORDERING PROVIDER
        </Label>
        <select
          id="order-provider"
          value={order.providerId}
          onChange={(e) => setOrder((prev) => ({ ...prev, providerId: e.target.value }))}
          className="h-8 w-72 rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Choose a provider…</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
              {provider.npi ? ` · NPI ${provider.npi}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">PANEL</span>
        <div className="flex flex-wrap gap-1.5">
          {LAB_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => setOrder((prev) => applyPreset(prev, preset))}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A panel replaces the current selection. Adjust it below afterwards.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">
          TESTS ({order.testCodes.length})
        </span>
        <ul className="grid gap-x-4 sm:grid-cols-2">
          {LAB_TESTS.map((test) => {
            const selected = order.testCodes.includes(test.code)
            return (
              <li key={test.code} className="flex flex-col gap-0.5 py-1">
                <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleTest(test.code)}
                    className="size-3.5"
                  />
                  {test.name}
                </label>
                {selected && (
                  <span className="flex flex-wrap items-center gap-3 pl-5.5 text-xs text-muted-foreground">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={order.requiredCodes.includes(test.code)}
                        onChange={() => toggleFlag('requiredCodes', test.code)}
                        className="size-3"
                      />
                      Required
                    </label>
                    {/* Hidden rather than disabled where discounted labs are not
                        legal, so it is never presented as an available choice. */}
                    {!restricted && (
                      <label className="flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={order.compedCodes.includes(test.code)}
                          onChange={() => toggleFlag('compedCodes', test.code)}
                          className="size-3"
                        />
                        Covered by AlphaMD
                      </label>
                    )}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {order.testCodes.includes(PHLEBOTOMY_CODE) && (
          <p className="text-xs text-amber-700">
            Therapeutic phlebotomy must be ordered on its own requisition.
          </p>
        )}
        {restricted && (
          <p className="text-xs text-muted-foreground">
            Discounted labs are not available in {patientState}, so coverage cannot be applied.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider text-muted-foreground">
          DIAGNOSIS CODES
        </span>
        <ul className="flex flex-col">
          {DIAGNOSIS_CODES.map((dx) => (
            <li key={dx.code}>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                <input
                  type="checkbox"
                  checked={order.diagnosisCodes.includes(dx.code)}
                  onChange={() => toggleDiagnosis(dx.code)}
                  className="size-3.5"
                />
                {dx.name}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t pt-3">
        {problems.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button
            disabled={pending || problems.length > 0}
            title={problems.length ? problems.join(' ') : undefined}
            onClick={() => onSubmit(order)}
          >
            {pending
              ? 'Placing…'
              : order.timing === 'now'
                ? 'Order labs now'
                : `Schedule for ${scheduledDate ? shortDate(scheduledDate.toISOString()) : '…'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
