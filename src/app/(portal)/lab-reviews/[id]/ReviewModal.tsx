'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROTOCOL_DECISIONS, STATIC_NOTICES, type ProtocolDecisionId } from '@/lib/labReviews/fixtures'

/**
 * The review modal is **fully interactive but saves nothing**, and says so.
 *
 * `lab_reviews` has a free-text `resolution` column and no structured outcome
 * table at all — no decision, no dose change, no new-medication list, and no
 * draft state. Persisting this needs a migration, and migrations live in the
 * alphamd repo, which this iteration does not touch.
 *
 * It ships interactive rather than disabled so the interaction design can
 * actually be reviewed, with a non-dismissable "Draft only — not saved" banner
 * so nobody mistakes it for a working control. The SQL that would unblock it is
 * in the plan under "Deferred".
 */

type NewMed = { key: number; name: string; dose: string }

export function ReviewModal({
  patientName,
  collectionDate,
  onClose,
}: {
  patientName: string
  collectionDate: string | null
  onClose: () => void
}) {
  const [decision, setDecision] = useState<ProtocolDecisionId>('keep')
  const [newMeds, setNewMeds] = useState<NewMed[]>([])
  const [nextKey, setNextKey] = useState(1)

  const addMed = () => {
    setNewMeds((meds) => [...meds, { key: nextKey, name: '', dose: '' }])
    setNextKey((k) => k + 1)
  }

  return (
    // Base UI's Dialog, restyled as the design's right-hand sheet. Using it
    // rather than a hand-rolled overlay is what gives focus trapping, Esc to
    // close, scroll lock and the aria wiring.
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="top-0 left-auto right-0 flex h-dvh w-[480px] max-w-[92vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-card p-0 sm:max-w-[92vw]"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <DialogTitle className="text-base font-semibold tracking-tight">
              Lab review — {patientName}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              {[collectionDate ? `Labs ${collectionDate}` : null, 'standardized review']
                .filter(Boolean)
                .join(' · ')}
            </DialogDescription>
          </div>
        </div>

        <p className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-900">
          {STATIC_NOTICES.reviewModal} — there is nowhere to store a structured
          review outcome yet, so nothing on this panel is written to the
          database.
        </p>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-bold tracking-wider text-muted-foreground">
              PROTOCOL DECISION
            </legend>
            <div className="flex flex-col gap-1.5">
              {PROTOCOL_DECISIONS.map((d) => {
                const selected = decision === d.id
                return (
                  <label
                    key={d.id}
                    className={[
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
                      selected ? 'border-green-600 bg-green-50' : 'border-border bg-card',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="decision"
                      value={d.id}
                      checked={selected}
                      onChange={() => setDecision(d.id)}
                      className="mt-1 size-3.5 accent-green-600"
                    />
                    <span>
                      <span className="block text-[13px] font-semibold">{d.label}</span>
                      <span className="block text-xs text-muted-foreground">{d.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          {decision === 'dose' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                DOSE CHANGE
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="dose-medication" className="text-xs text-muted-foreground">
                    Medication
                  </Label>
                  <Input id="dose-medication" placeholder="e.g. Testosterone Cypionate" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="dose-value" className="text-xs text-muted-foreground">
                    New dose
                  </Label>
                  <Input id="dose-value" placeholder="e.g. 180 mg/wk" />
                </div>
              </div>
            </div>
          )}

          {decision === 'instructions' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-instructions" className="text-xs font-bold tracking-wider text-muted-foreground">
                NEW INSTRUCTIONS
              </Label>
              <Textarea
                id="new-instructions"
                rows={4}
                placeholder="Instructions for the patient (timing, titration, follow-up draw)…"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                NEW MEDICATIONS
              </span>
              <Button variant="outline" size="xs" onClick={addMed}>
                <Plus />
                Add
              </Button>
            </div>

            {newMeds.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                No new medications added.
              </p>
            ) : (
              newMeds.map((med) => (
                <div key={med.key} className="grid grid-cols-[1.2fr_1fr_auto] items-center gap-2">
                  <Input
                    aria-label="Medication"
                    placeholder="Medication"
                    value={med.name}
                    onChange={(e) =>
                      setNewMeds((meds) =>
                        meds.map((m) => (m.key === med.key ? { ...m, name: e.target.value } : m))
                      )
                    }
                  />
                  <Input
                    aria-label="Dose or sig"
                    placeholder="Dose / sig"
                    value={med.dose}
                    onChange={(e) =>
                      setNewMeds((meds) =>
                        meds.map((m) => (m.key === med.key ? { ...m, dose: e.target.value } : m))
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove medication"
                    onClick={() => setNewMeds((meds) => meds.filter((m) => m.key !== med.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="areas-of-concern" className="text-xs font-bold tracking-wider text-muted-foreground">
              AREAS OF CONCERN
            </Label>
            <Textarea
              id="areas-of-concern"
              rows={4}
              placeholder="Clinical concerns to document (e.g. Hct trending up — recheck CBC in 8 weeks)…"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cs-instructions" className="text-xs font-bold tracking-wider text-muted-foreground">
              INSTRUCTIONS FOR CUSTOMER SERVICE
            </Label>
            <Textarea
              id="cs-instructions"
              rows={3}
              placeholder="What CS should relay or handle (shipment changes, scheduling, patient outreach)…"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2.5 border-t bg-muted/40 px-5 py-3.5">
          <Button variant="outline" disabled title={STATIC_NOTICES.reviewModal}>
            Save draft
          </Button>
          <Button disabled title={STATIC_NOTICES.reviewModal}>
            Finalize lab review
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
