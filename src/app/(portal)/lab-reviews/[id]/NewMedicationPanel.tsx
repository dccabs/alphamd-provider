'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

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
import { newMedicationLines } from '@/lib/labReviews/completion'
import {
  initialSelection,
  selectionValue,
  type DoseSelection,
} from '@/lib/labReviews/doseSelection'
import { dosesInWeeklyMg, readDose } from '@/lib/labReviews/dosing'
import type { DraftMedication } from '@/lib/labReviews/reviewDraft'
import { DoseFields, SELECT_CLASS } from './DoseFields'
import type { CatalogMedication, DosageOption, Medication } from './types'

/**
 * Adding a medication to the protocol from inside a lab review.
 *
 * This is deliberately reachable under every disposition, not just the follow-up
 * one. Deciding to raise a testosterone dose and to start anastrozole is one
 * decision made at one moment, and a form that made the provider choose between
 * recording the two would get one of them recorded in prose, where nothing
 * downstream can act on it.
 *
 * It is the sibling of `DoseChangePanel` and shares its tooling — `DoseFields`
 * for the dose, `medication_dosage` for the catalog, `dosesInWeeklyMg` for the
 * weekly-milligram calculator — so a dose recorded here reads exactly like one
 * recorded there. What differs is where the medication comes from: a dose change
 * picks off the patient's own list, and this picks off the whole catalog, because
 * the point is a medication they are not on yet.
 *
 * Nothing here writes to `patient_medications`. The review records the decision;
 * the prescription is still created on the medications tab in the admin app.
 */

export function NewMedicationPanel({
  catalog,
  medications,
  dosageOptions,
  added,
  canAdd,
  onChange,
}: {
  /** Everything that can be started. Restricted medications are already gone. */
  catalog: CatalogMedication[]
  /** What the patient is on, for warning about a medication twice over. */
  medications: Medication[]
  dosageOptions: DosageOption[]
  added: DraftMedication[]
  /** False under a disposition that cannot add one — the rows already added stay
   *  editable and removable, but no more can be started. */
  canAdd: boolean
  onChange: (added: DraftMedication[]) => void
}) {
  /** Which row the dialog is editing: an index, `'new'`, or closed. */
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  const confirm = (med: DraftMedication) => {
    onChange(
      editing === 'new' || editing === null
        ? [...added, med]
        : added.map((row, index) => (index === editing ? med : row))
    )
    setEditing(null)
  }

  return (
    // No heading: this sits inside a `ReviewStep`, which titles it.
    <div className="flex flex-col gap-2">
      {!canAdd && (
        <p className="text-xs text-amber-700">
          Continuing the protocol as designed cannot also start a medication. Remove it, or choose
          another disposition.
        </p>
      )}

      {added.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          Nothing being added. Adjusting something the patient is already on is a dose change rather
          than an addition.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {added.map((med, index) => (
            <AddedMedication
              // Index as key is safe only because rows are never reordered —
              // adding appends and removing splices.
              key={index}
              med={med}
              onEdit={() => setEditing(index)}
              onRemove={() => onChange(added.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}

      {canAdd && (
        <div>
          <Button variant="outline" size="xs" onClick={() => setEditing('new')}>
            <Plus />
            Add medication to protocol
          </Button>
        </div>
      )}

      {editing !== null && (
        <NewMedicationDialog
          catalog={catalog}
          medications={medications}
          dosageOptions={dosageOptions}
          initial={editing === 'new' ? null : added[editing]}
          onCancel={() => setEditing(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  )
}

function AddedMedication({
  med,
  onEdit,
  onRemove,
}: {
  med: DraftMedication
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-green-600 bg-green-50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{med.name}</div>
        {med.dose && <div className="mt-0.5 text-xs">{med.dose}</div>}
        {med.sig && <div className="mt-0.5 text-xs text-muted-foreground">{med.sig}</div>}
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

/**
 * The medication on top, the dose under it, and the exact sentences that will be
 * recorded at the bottom.
 *
 * Which dose inputs appear follows the medication, so choosing one resets the
 * dose. Carrying a weekly-milligram figure over from testosterone onto a tablet,
 * or a tablet's catalog id onto an injection, is the one way this dialog could
 * record a dose that was never chosen.
 */
function NewMedicationDialog({
  catalog,
  medications,
  dosageOptions,
  initial,
  onCancel,
  onConfirm,
}: {
  catalog: CatalogMedication[]
  medications: Medication[]
  dosageOptions: DosageOption[]
  /** A medication already added, when reopening to edit it. */
  initial: DraftMedication | null
  onCancel: () => void
  onConfirm: (med: DraftMedication) => void
}) {
  const [medicationId, setMedicationId] = useState<number | null>(initial?.medicationId ?? null)

  const chosen = catalog.find((med) => med.id === medicationId) ?? null
  const calculated = medicationId !== null && dosesInWeeklyMg(medicationId)
  const options = dosageOptions.filter((option) => option.medicationId === medicationId)

  // Reopening starts from what was confirmed; the schedule and the route are read
  // back out of the sig, since `160mg/week` does not carry them.
  const reopened = initial?.sig ? readDose({ name: initial.name, dosage: initial.sig }) : null

  const [selection, setSelection] = useState<DoseSelection>(() =>
    initialSelection({
      previous: initial
        ? {
            value: initial.dose,
            sig: initial.sig,
            perWeek: reopened?.kind === 'injection' ? reopened.perWeek : undefined,
            route: reopened?.kind === 'injection' ? reopened.route : undefined,
          }
        : null,
      options,
    })
  )

  const dose = selectionValue(selection, { calculated, options })

  const pending: DraftMedication | null =
    chosen && dose
      ? {
          medicationId: chosen.id,
          name: chosen.name,
          dose: dose.value,
          sig: dose.sig,
          dosageMg: dose.weeklyMg,
        }
      : null

  const lines = pending ? newMedicationLines(pending) : null

  // Warned rather than blocked: `Other` is on hundreds of charts more than once,
  // and a provider adding a second row of something knows more than this dialog
  // does. What it must not do is let a dose change be mistaken for an addition.
  const alreadyOn = medications.some((med) => med.active && med.medicationId === medicationId)

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="w-full gap-0 sm:max-w-2xl">
        <DialogHeader className="pb-4">
          <DialogTitle>Add a medication to the protocol</DialogTitle>
          <DialogDescription>
            The review records the decision. The prescription itself is still created on the
            medications tab.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-med-name" className="text-xs text-muted-foreground">
              Medication
            </Label>
            <select
              id="new-med-name"
              value={medicationId ?? ''}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null
                setMedicationId(next)
                setSelection(
                  initialSelection({
                    options: dosageOptions.filter((option) => option.medicationId === next),
                  })
                )
              }}
              className={`${SELECT_CLASS} w-full`}
            >
              <option value="">Choose a medication…</option>
              {catalog.map((med) => (
                <option key={med.id} value={med.id}>
                  {med.name}
                </option>
              ))}
            </select>
            {alreadyOn && (
              <p className="text-xs text-amber-700">
                The patient is already on this. Adjusting what they are taking is a dose change
                rather than an addition.
              </p>
            )}
          </div>

          {chosen && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">DOSE</span>
              <DoseFields
                selection={selection}
                onChange={setSelection}
                calculated={calculated}
                options={options}
                idPrefix="new-med"
              />
            </div>
          )}

          {lines && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                WILL BE RECORDED AS
              </span>
              <p className="text-xs leading-relaxed">{lines.chart}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                For customer service: {lines.cs}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => pending && onConfirm(pending)} disabled={!pending}>
            {initial ? 'Save medication' : 'Add medication'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
