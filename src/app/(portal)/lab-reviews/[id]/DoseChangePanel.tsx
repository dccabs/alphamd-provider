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
import { doseChangeLines } from '@/lib/labReviews/completion'
import {
  initialSelection,
  selectionValue,
  type DoseSelection,
} from '@/lib/labReviews/doseSelection'
import { readDose, weeklyMgLabel, type CurrentDose } from '@/lib/labReviews/dosing'
import { DoseFields } from './DoseFields'
import type { DosageOption, Medication } from './types'

/**
 * Changing a dose by picking the prescription off the patient's own list.
 *
 * This replaced two free-text boxes. Typing a medication name and a dose meant
 * the provider had to remember what the patient was actually on, and the record
 * that came out said what the new dose was but never what it changed *from* —
 * which is the only part that makes a dose change reviewable afterwards.
 *
 * So the list is the input, and it is the *only* input: a medication the patient
 * is not already on cannot be reached from here, because starting one is not a
 * dose change. That is what the follow-up disposition's "Add a new medication" is
 * for. Every active prescription is shown with the dose it is on, in weekly
 * milligrams wherever that can be established from the sig, and choosing one
 * opens a dialog with the current figure already in front of the provider.
 *
 * What the new dose can be follows the admin app's medication modal. Injectable
 * testosterone gets the weekly-milligram calculator, because that is how a TRT
 * dose is decided and the sig is derived from it. Everything else gets the doses
 * the clinic actually keeps for that medication — `medication_dosage`, the same
 * list the modal's dropdown shows — with a personal dose to type when none of
 * them is right.
 *
 * Nothing here writes to `patient_medications`: the review documents the
 * decision, and the prescription itself is still edited on the medications tab in
 * the admin app.
 */

export type DoseChange = {
  /** The `patient_medications` row being changed. Nullable only because a draft
   *  saved before this panel existed carries a typed name and no row. */
  medicationId: number | null
  medication: string
  from: string
  value: string
  sig: string
}

export function DoseChangePanel({
  medications,
  dosageOptions,
  change,
  onChange,
}: {
  medications: Medication[]
  dosageOptions: DosageOption[]
  /** null until a change has been confirmed. */
  change: DoseChange | null
  onChange: (change: DoseChange | null) => void
}) {
  /** Which prescription is being changed. Absent means the dialog is closed. */
  const [editing, setEditing] = useState<Medication | null>(null)

  // Expired rows are left out: a dose change is a change to what the patient is
  // taking now, and restarting something lapsed is a new prescription.
  const active = medications.filter((med) => med.active)

  // Reopening looks through every medication rather than the active ones, so a
  // prescription that lapses between confirming and finishing can still be
  // edited. A draft saved before this panel existed has a typed name and no row
  // to find, and can only be cleared and redone — hence the null.
  const editable = change ? (medications.find((m) => m.id === change.medicationId) ?? null) : null

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold tracking-wider text-muted-foreground">DOSE CHANGE</span>

      {change ? (
        <ConfirmedChange
          change={change}
          onEdit={editable ? () => setEditing(editable) : null}
          onClear={() => onChange(null)}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {active.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
              No active medications on record. Starting one is a follow-up rather than a dose
              change.
            </p>
          ) : (
            active.map((med) => (
              <MedicationChoice key={med.id} med={med} onSelect={() => setEditing(med)} />
            ))
          )}
        </div>
      )}

      {editing && (
        <DoseChangeDialog
          med={editing}
          options={dosageOptions.filter((o) => o.medicationId === editing.medicationId)}
          initial={change}
          onCancel={() => setEditing(null)}
          onConfirm={(next) => {
            onChange(next)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** One prescription, with what it is dosed at. The dose is the reason to pick a
 *  row, so it is on the row rather than behind the click. */
function MedicationChoice({ med, onSelect }: { med: Medication; onSelect: () => void }) {
  const dose = readDose(med)

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left hover:border-green-600 hover:bg-green-50"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{med.name}</span>
        {dose.kind === 'injection' && (
          <span className="shrink-0 text-xs font-semibold">{weeklyMgLabel(dose.weeklyMg)}</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{dose.text || 'No dose recorded'}</span>
    </button>
  )
}

function ConfirmedChange({
  change,
  onEdit,
  onClear,
}: {
  change: DoseChange
  /** null when the prescription this change refers to is no longer on the list. */
  onEdit: (() => void) | null
  onClear: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-green-600 bg-green-50 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{change.medication}</div>
        <div className="mt-0.5 text-xs">
          {change.from ? `${change.from} → ${change.value}` : change.value}
        </div>
        {change.sig && <div className="mt-0.5 text-xs text-muted-foreground">{change.sig}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onEdit && (
          <Button variant="outline" size="xs" onClick={onEdit}>
            Edit
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}

/**
 * Current dose on the left of the arrow, new dose on the right, and the exact
 * sentences that will be recorded underneath.
 *
 * The preview is the point of the confirm step. A dose entered in mg/week is
 * turned into a volume and a schedule by arithmetic the provider cannot see, so
 * the sig it produces has to be readable *before* it becomes a chart entry.
 */
function DoseChangeDialog({
  med,
  options,
  initial,
  onCancel,
  onConfirm,
}: {
  med: Medication
  /** The catalog doses for this medication. Often empty — `Other` has none. */
  options: DosageOption[]
  /** A change already confirmed for this medication, when reopening to edit it. */
  initial: DoseChange | null
  onCancel: () => void
  onConfirm: (change: DoseChange) => void
}) {
  const current: CurrentDose = readDose(med)
  const calculated = current.kind === 'injection'

  // Neither the schedule nor the route can be recovered from `160mg/week`, so a
  // reopened change is read back out of the sig it generated.
  const reopened =
    initial?.medicationId === med.id && initial.sig
      ? readDose({ name: med.name, dosage: initial.sig })
      : null

  const [selection, setSelection] = useState<DoseSelection>(() =>
    initialSelection({
      from: current.kind === 'injection' ? current : null,
      previous:
        initial?.medicationId === med.id
          ? {
              ...initial,
              perWeek: reopened?.kind === 'injection' ? reopened.perWeek : undefined,
              route: reopened?.kind === 'injection' ? reopened.route : undefined,
            }
          : null,
      options,
    })
  )

  const chosen = selectionValue(selection, { calculated, options })

  const pending: DoseChange = {
    medicationId: med.id,
    medication: med.name,
    from: calculated
      ? weeklyMgLabel(current.weeklyMg)
      : current.kind === 'opaque'
        ? (current.text ?? '')
        : '',
    value: chosen?.value ?? '',
    sig: chosen?.sig ?? '',
  }

  // A route or a schedule can change on its own — the same weekly dose delivered
  // intramuscularly, or split over more injections, is a different prescription.
  const unchanged =
    current.kind === 'injection'
      ? !!chosen &&
        Number.parseFloat(selection.weeklyMg) === current.weeklyMg &&
        selection.perWeek === current.perWeek &&
        selection.route === current.route
      : !!chosen && pending.value === pending.from.trim()

  const lines = doseChangeLines(pending)

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="w-full gap-0 sm:max-w-lg">
        <DialogHeader className="pb-4">
          <DialogTitle>{med.name}</DialogTitle>
          <DialogDescription>
            {current.kind === 'injection'
              ? 'Set the new weekly dose, route and schedule. The instruction below is what goes on the chart.'
              : options.length > 0
                ? 'Pick one of the doses this is prescribed at, or write a personal one.'
                : 'There are no standard doses recorded for this medication, so write the new one out.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold tracking-wider text-muted-foreground">CURRENT</span>
            {current.kind === 'injection' ? (
              <>
                <span className="text-lg font-semibold">{weeklyMgLabel(current.weeklyMg)}</span>
                <span className="text-xs text-muted-foreground">{current.text}</span>
              </>
            ) : (
              <span className="text-[13px]">
                {current.text ?? <span className="text-muted-foreground">Nothing on record</span>}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="text-xs font-bold tracking-wider text-muted-foreground">NEW</span>

            <DoseFields
              selection={selection}
              onChange={setSelection}
              calculated={calculated}
              options={options}
              idPrefix="dose"
            />
          </div>

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

          {unchanged && (
            <p className="text-xs text-muted-foreground">
              That is the dose the patient is already on.
            </p>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => lines && onConfirm(pending)} disabled={!lines || unchanged}>
            Confirm dose change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
