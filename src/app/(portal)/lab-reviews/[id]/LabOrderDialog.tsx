'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  orderLine,
  scheduledDateFor,
  validateOrder,
  type LabOrder,
} from '@/lib/labOrders/order'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import { shortDate } from '@/lib/labReviews/format'
import { SELECT_CLASS } from './DoseFields'

/**
 * Composing a lab order: the panel, the tests, when it goes out, and who signs it.
 *
 * One screen rather than the main app's four-step wizard. A provider looking at
 * abnormal results already knows what they want to order and on what interval;
 * stepping them through date, then tests, then confirmation adds clicks without
 * adding a decision. The presets do the work the wizard's steps were carrying.
 *
 * ## Confirming attaches; it does not order
 *
 * Nothing here reaches the database. The order is handed back to the flyout, saved
 * into `lab_reviews.draft` with everything else the provider is writing, and
 * placed only when the review is approved. That is the point of the deferral: a
 * lab order emails the patient and charges them, so it should not go out while the
 * assessment behind it is still half-written.
 *
 * Orders the patient *already* has are shown at the top, and cancelling one is
 * the exception — that is a live row the main app's cron may act on within
 * minutes, so it is cancelled immediately rather than at approval. Without the
 * list a provider cannot see that a redraw was already scheduled last week, and a
 * duplicate order means the patient pays twice and visits a lab twice.
 */

type Props = {
  patientState: string | null
  providers: LabProviderOption[]
  existing: ScheduledLabOrder[]
  /** An order already attached to this review, when reopening to edit it. */
  initial: LabOrder | null
  /** True while a cancellation of an already-scheduled order is in flight. */
  cancelling: boolean
  onCancelScheduled: (scheduledId: string) => void
  onCancel: () => void
  onConfirm: (order: LabOrder) => void
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

export function LabOrderDialog({
  patientState,
  providers,
  existing,
  initial,
  cancelling,
  onCancelScheduled,
  onCancel,
  onConfirm,
}: Props) {
  const [order, setOrder] = useState<LabOrder>(
    () =>
      initial ?? {
        ...EMPTY_ORDER,
        // With one provider on file there is no decision to make.
        providerId: providers.length === 1 ? providers[0].id : '',
      }
  )
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
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      {/* 4xl, the cap shared by the content-heavy dialogs in the review. This is
          the one that needs all of it: a two-column test list, a diagnosis list and
          the orders the patient already has, on one screen. */}
      <DialogContent className="max-h-[90dvh] w-full gap-0 overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="pb-4 pr-8">
          <DialogTitle>{initial ? 'Edit the lab order' : 'Order labs'}</DialogTitle>
          <DialogDescription>
            The patient is emailed an order they can take to any lab. Nothing is sent until you
            approve the review.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4 border-t pt-4">
          {existing.length > 0 && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                ALREADY ORDERED
              </span>
              {/* Two lines rather than one wrapping row. A full panel is a dozen
                  comma-joined test names, and on one line that list was the widest
                  thing in the dialog — squeezing every other cell and pushing the
                  row past the popup's edge. Given its own line it wraps and clamps,
                  so the longest name in the catalog cannot widen the layout. */}
              <ul className="flex min-w-0 flex-col divide-y rounded-lg border">
                {existing.map((entry) => (
                  <li key={entry.id} className="flex min-w-0 flex-col gap-1 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`shrink-0 rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${
                          STATUS_TONE[entry.status] ?? STATUS_TONE.expired
                        }`}
                      >
                        {(STATUS_LABELS[entry.status] ?? entry.status).toUpperCase()}
                      </span>
                      <span className="text-[13px] font-medium">
                        {entry.scheduledDate ? shortDate(entry.scheduledDate) : 'No date'}
                      </span>
                      {entry.status === 'pending' &&
                        (confirmCancel === entry.id ? (
                          <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={cancelling}
                              onClick={() => {
                                setConfirmCancel(null)
                                onCancelScheduled(entry.id)
                              }}
                            >
                              Cancel it
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cancelling}
                              onClick={() => setConfirmCancel(null)}
                            >
                              Keep
                            </Button>
                          </span>
                        ) : (
                          <Button
                            className="ml-auto shrink-0"
                            variant="ghost"
                            size="sm"
                            disabled={cancelling}
                            onClick={() => setConfirmCancel(entry.id)}
                          >
                            Cancel
                          </Button>
                        ))}
                    </div>
                    <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                      {entry.testNames.join(', ') || 'No tests recorded'}
                    </span>
                  </li>
                ))}
              </ul>
              {pendingExisting.length > 0 && (
                <p className="text-xs text-amber-700">
                  {pendingExisting.length === 1
                    ? 'This patient already has a scheduled lab order.'
                    : `This patient already has ${pendingExisting.length} scheduled lab orders.`}{' '}
                  Cancel it first unless you mean to order twice. Cancelling takes effect
                  immediately, not at approval.
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
                className={`${SELECT_CLASS} w-44`}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {order.timing === 'now'
                ? 'The order goes out within a few minutes of the review being approved.'
                : scheduledDate
                  ? `The patient is emailed the order on ${shortDate(
                      scheduledDate.toISOString()
                    )}, and a heads-up once the review is approved.`
                  : 'Pick the date these labs should be sent.'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="order-provider"
              className="text-xs font-bold tracking-wider text-muted-foreground"
            >
              ORDERING PROVIDER
            </Label>
            <select
              id="order-provider"
              value={order.providerId}
              onChange={(e) => setOrder((prev) => ({ ...prev, providerId: e.target.value }))}
              className={`${SELECT_CLASS} w-72`}
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
            <p className="text-xs text-muted-foreground">
              Required means the patient cannot remove it from their order.
            </p>
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

          {problems.length === 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 px-3 py-2.5">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                WILL BE RECORDED AS
              </span>
              <p className="text-xs leading-relaxed">{orderLine(order)}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 sm:justify-between">
          {problems.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <span />
          )}
          <span className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(order)}
              disabled={problems.length > 0}
              title={problems.length ? problems.join(' ') : undefined}
            >
              {initial ? 'Save order' : 'Add to review'}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
