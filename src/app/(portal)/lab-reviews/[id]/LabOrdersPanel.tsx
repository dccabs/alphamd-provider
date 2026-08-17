'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { orderLine, type LabOrder } from '@/lib/labOrders/order'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import { shortDate } from '@/lib/labReviews/format'
import { LabOrderDialog } from './LabOrderDialog'

/**
 * Lab orders attached to the review.
 *
 * Reachable under every disposition, like `NewMedicationPanel`. Ordering a redraw
 * is not only something a "Follow-up needed" review does: a dose change is
 * normally followed by labs to check it landed, and continuing a protocol as
 * designed still means labs on an interval.
 *
 * The rows here are drafts. They are saved with the review and placed at approval,
 * so each one shows the same line the confirmation summary and the chart note will
 * show — `orderLine` is what makes those three agree.
 */

export function LabOrdersPanel({
  patientState,
  providers,
  scheduled,
  orders,
  cancelling,
  onCancelScheduled,
  onChange,
}: {
  /** For the comped-labs restriction, which is a legal one in NY and NJ. */
  patientState: string | null
  /** Signing providers — `lab_providers`, not portal accounts. */
  providers: LabProviderOption[]
  /** What the patient already has on order, placed by an earlier review. */
  scheduled: ScheduledLabOrder[]
  orders: LabOrder[]
  cancelling: boolean
  onCancelScheduled: (scheduledId: string) => void
  onChange: (orders: LabOrder[]) => void
}) {
  /** Which order the dialog is editing: an index, `'new'`, or closed. */
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const confirm = (order: LabOrder) => {
    onChange(
      editing === 'new' || editing === null
        ? [...orders, order]
        : orders.map((row, index) => (index === editing ? order : row))
    )
    setEditing(null)
  }

  const pending = scheduled.filter((entry) => entry.status === 'pending')

  return (
    // No heading: this sits inside a `ReviewStep`, which titles it.
    <div className="flex flex-col gap-2">
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          No labs ordered in this review.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {orders.map((order, index) => (
            <AttachedOrder
              // Index as key is safe only because rows are never reordered —
              // adding appends and removing splices.
              key={index}
              order={order}
              onEdit={() => setEditing(index)}
              onRemove={() => onChange(orders.filter((_, i) => i !== index))}
            />
          ))}
          <p className="text-xs text-muted-foreground">
            Sent when the review is approved, not now.
          </p>
        </div>
      )}

      <div>
        <Button variant="outline" size="xs" onClick={() => setEditing('new')}>
          <Plus />
          {orders.length === 0 ? 'Order labs' : 'Order more labs'}
        </Button>
      </div>

      {/* Named here as well as in the dialog: a provider who never opens the
          dialog would otherwise order a second draw without knowing about the
          first, and the patient would pay for both. */}
      {pending.length > 0 && (
        <p className="text-xs text-amber-700">
          {pending.length === 1
            ? `This patient already has labs scheduled for ${
                pending[0].scheduledDate ? shortDate(pending[0].scheduledDate) : 'an unknown date'
              }.`
            : `This patient already has ${pending.length} scheduled lab orders.`}{' '}
          Open Order labs to see or cancel them.
        </p>
      )}

      {editing !== null && (
        <LabOrderDialog
          patientState={patientState}
          providers={providers}
          existing={scheduled}
          initial={editing === 'new' ? null : orders[editing]}
          cancelling={cancelling}
          onCancelScheduled={onCancelScheduled}
          onCancel={() => setEditing(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}

function AttachedOrder({
  order,
  onEdit,
  onRemove,
}: {
  order: LabOrder
  onEdit: () => void
  onRemove: () => void
}) {
  const required = order.requiredCodes.length
  const covered = order.compedCodes.length

  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-green-600 bg-green-50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{orderLine(order)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[
            `${order.diagnosisCodes.join(', ') || 'no diagnosis code'}`,
            required ? `${required} required` : null,
            covered ? `${covered} covered by AlphaMD` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="xs" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="xs" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  )
}
