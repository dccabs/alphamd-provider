'use client'

import { useEffect, useState } from 'react'

import type { AssignedCoupon } from '@/lib/protocols/assignedCoupon'
import { expiredAssignedCoupon } from '@/lib/labReviews/discountSeed'
import type { ReviewDraft } from '@/lib/labReviews/reviewDraft'
import type { ProtocolOutcome } from '@/lib/labReviews/completion'
import { previewProtocolAction, type ProtocolPreview } from '../actions'

/**
 * Catalog Discounts and the assigned Coupon, next to the live quote.
 *
 * Newsletter and a live Coupon start on (seeded once onto the draft). The
 * Provider can take them off. An expired assigned Coupon is shown, not applied,
 * until they check it.
 */

export function DiscountsPanel({
  draft,
  assignedCoupon,
  onChange,
}: {
  draft: ReviewDraft
  assignedCoupon: AssignedCoupon | null
  onChange: (patch: Pick<ReviewDraft, 'selectedDiscountIds' | 'couponCode'>) => void
}) {
  const [preview, setPreview] = useState<ProtocolPreview | null>(null)

  useEffect(() => {
    let live = true
    previewProtocolAction(JSON.stringify(draft))
      .then((next) => live && setPreview(next))
      .catch(() => live && setPreview({ outcome: null, offeredDiscounts: [] }))
    return () => {
      live = false
    }
  }, [draft])

  const expired = expiredAssignedCoupon(assignedCoupon)
  const offered = preview?.offeredDiscounts ?? []
  const unused = preview?.outcome?.kind === 'quote' ? preview.outcome.unusedDiscounts : []

  const toggleDiscount = (id: number, on: boolean) => {
    onChange({
      selectedDiscountIds: on
        ? draft.selectedDiscountIds.includes(id)
          ? draft.selectedDiscountIds
          : [...draft.selectedDiscountIds, id]
        : draft.selectedDiscountIds.filter((chosen) => chosen !== id),
      couponCode: draft.couponCode,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <QuoteCard outcome={preview?.outcome ?? null} unused={unused} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium">Catalog discounts</legend>
        {offered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None of the catalog discounts apply to this subscription.
          </p>
        ) : null}
        {offered.map((row) => (
          <label key={row.id} className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.selectedDiscountIds.includes(row.id)}
              onChange={(event) => toggleDiscount(row.id, event.target.checked)}
            />
            <span>{row.name}</span>
          </label>
        ))}
        {unused.map((line) => (
          <label key={line} className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <input type="checkbox" className="mt-0.5" checked disabled />
            <span>{line}</span>
          </label>
        ))}
      </fieldset>

      {assignedCoupon && hasMedicationLook(assignedCoupon) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium">Coupon</legend>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={
                draft.couponCode?.toLowerCase() === assignedCoupon.code.toLowerCase()
              }
              onChange={(event) =>
                onChange({
                  selectedDiscountIds: draft.selectedDiscountIds,
                  couponCode: event.target.checked ? assignedCoupon.code : null,
                })
              }
            />
            <span>
              Coupon {assignedCoupon.code}
              {expired ? ' (expired — check to apply anyway)' : ''}
            </span>
          </label>
        </fieldset>
      ) : null}
    </div>
  )
}

function hasMedicationLook(coupon: AssignedCoupon): boolean {
  return coupon.targetPrice1mo !== null || coupon.discountType !== null
}

function QuoteCard({
  outcome,
  unused,
}: {
  outcome: ProtocolOutcome | null
  unused: string[]
}) {
  if (!outcome) {
    return <p className="text-xs text-muted-foreground">Working out the price…</p>
  }

  if (outcome.kind === 'handed-off') {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2.5 text-[13px]">
        This protocol cannot be quoted here.
        <ul className="mt-1.5 text-xs text-muted-foreground">
          {outcome.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
      <p className="font-semibold">{outcome.total} due today</p>
      <pre className="mt-1.5 font-sans text-xs leading-relaxed whitespace-pre-wrap">
        {outcome.lines.join('\n')}
      </pre>
      {outcome.caveat ? (
        <p className="mt-2 text-xs text-muted-foreground">{outcome.caveat}</p>
      ) : null}
      {unused.length > 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Checked but not used</p>
          <ul className="mt-1">
            {unused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
