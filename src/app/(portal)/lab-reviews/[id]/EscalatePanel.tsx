'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import {
  EMPTY_ESCALATION,
  ESCALATION_TARGETS,
  ESCALATION_TARGET_HINTS,
  ESCALATION_TARGET_LABELS,
  SELF_PARK_HINT,
  transfersOwnership,
  validateEscalation,
  type Escalation,
  type EscalationTarget,
} from '@/lib/labReviews/needsAttention'
import { describeEscalation } from '@/lib/ai/decision'
import { AssistButton } from './AssistButton'
import type { ProviderOption } from './types'

/**
 * The Needs Attention menu.
 *
 * Targets are optional. Leaving both unchecked parks the review for the
 * assigned provider — a note, no CS task, no handoff. Both targets can still
 * be picked at once: "CS needs to book a redraw *and* I want another provider
 * to look at this" is a real situation.
 *
 * The hint under "Customer service" says the review stays yours, because that is
 * the surprising part: escalating to CS looks like handing the work away, and it
 * deliberately does not.
 */
export function EscalatePanel({
  reviewId,
  providers,
  currentAssignee,
  pending,
  onSubmit,
  onCancel,
}: {
  reviewId: string
  providers: ProviderOption[]
  currentAssignee: string | null
  pending: boolean
  onSubmit: (escalation: Escalation) => void
  onCancel: () => void
}) {
  const [escalation, setEscalation] = useState<Escalation>(EMPTY_ESCALATION)

  const toggle = (target: EscalationTarget) =>
    setEscalation((e) => ({
      ...e,
      targets: e.targets.includes(target)
        ? e.targets.filter((t) => t !== target)
        : [...e.targets, target],
    }))

  const problems = validateEscalation(escalation)

  return (
    <div className="absolute top-10 right-0 z-40 flex w-88 flex-col gap-3 rounded-lg border bg-card p-3.5 shadow-lg">
      <span className="text-xs font-bold tracking-wider text-muted-foreground">
        NEEDS ATTENTION
      </span>

      <div className="flex flex-col gap-1.5">
        {ESCALATION_TARGETS.map((target) => (
          <label
            key={target}
            className={[
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
              escalation.targets.includes(target)
                ? 'border-amber-500 bg-amber-50'
                : 'border-border',
            ].join(' ')}
          >
            <input
              type="checkbox"
              checked={escalation.targets.includes(target)}
              onChange={() => toggle(target)}
              className="mt-0.5 size-3.5 accent-amber-600"
            />
            <span>
              <span className="block text-[13px] font-semibold">
                {ESCALATION_TARGET_LABELS[target]}
              </span>
              <span className="block text-xs text-muted-foreground">
                {ESCALATION_TARGET_HINTS[target]}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{SELF_PARK_HINT}</p>

      {transfersOwnership(escalation) && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="escalate-provider" className="text-xs text-muted-foreground">
            Hand to
          </Label>
          <select
            id="escalate-provider"
            value={escalation.toProviderId ?? ''}
            onChange={(e) =>
              setEscalation((prev) => ({ ...prev, toProviderId: e.target.value || null }))
            }
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">Choose a provider…</option>
            {providers
              // Handing a review to whoever already holds it is a no-op, so it is
              // not offered.
              .filter((p) => p.userId !== currentAssignee)
              .map((provider) => (
                <option key={provider.userId} value={provider.userId}>
                  {provider.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="escalate-note" className="text-xs text-muted-foreground">
          Why?
        </Label>
        <DictationTextarea
          id="escalate-note"
          rows={3}
          value={escalation.note}
          onValueChange={(note) => setEscalation((prev) => ({ ...prev, note }))}
          placeholder="Come back after I check last month's Hct…"
        />
        {/* describeEscalation says who the note is for — yourself, CS, or
            another provider — because those are not the same note. */}
        <AssistButton
          reviewId={reviewId}
          task="handoff_note"
          value={escalation.note}
          onChange={(note) => setEscalation((prev) => ({ ...prev, note }))}
          instructions={describeEscalation(escalation)}
          disabled={pending}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={pending || problems.length > 0}
          title={problems.length ? problems.join(' ') : undefined}
          onClick={() => onSubmit(escalation)}
        >
          {pending ? 'Parking…' : 'Mark needs attention'}
        </Button>
      </div>
    </div>
  )
}
