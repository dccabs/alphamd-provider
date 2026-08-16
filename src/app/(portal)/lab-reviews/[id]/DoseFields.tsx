'use client'

import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PERSONAL, type DoseSelection } from '@/lib/labReviews/doseSelection'
import { INJECTION_FREQUENCIES, INJECTION_ROUTES, type Route } from '@/lib/labReviews/dosing'
import type { DosageOption } from './types'

/**
 * The inputs a dose is chosen with, shared by the dose change dialog and the new
 * medication dialog.
 *
 * Which set is shown is the caller's decision, not this component's: `calculated`
 * comes from `dosesInWeeklyMg` for a medication being started and from the parsed
 * sig for one being changed. Guessing it from the data here would put the
 * 200mg/mL calculator in front of a provider prescribing a tablet.
 *
 * Controlled, with the whole selection replaced on every edit, so the dialog that
 * owns it can derive the preview and the confirmed value from one object.
 */
export function DoseFields({
  selection,
  onChange,
  calculated,
  options,
  idPrefix,
}: {
  selection: DoseSelection
  onChange: (selection: DoseSelection) => void
  /** True when the dose is decided in weekly milligrams. */
  calculated: boolean
  /** The catalog doses for this medication. Often empty — `Other` has none. */
  options: DosageOption[]
  /** Distinguishes the field ids, since two dialogs can be mounted at once. */
  idPrefix: string
}) {
  const set = (patch: Partial<DoseSelection>) => onChange({ ...selection, ...patch })

  if (calculated) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-weekly-mg`} className="text-xs text-muted-foreground">
            Weekly dose (mg)
          </Label>
          <Input
            id={`${idPrefix}-weekly-mg`}
            type="number"
            inputMode="decimal"
            min={0}
            step={10}
            value={selection.weeklyMg}
            onChange={(e) => set({ weeklyMg: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-route`} className="text-xs text-muted-foreground">
            Route
          </Label>
          <select
            id={`${idPrefix}-route`}
            value={selection.route}
            onChange={(e) => set({ route: e.target.value as Route })}
            className={SELECT_CLASS}
          >
            {INJECTION_ROUTES.map((option) => (
              <option key={option.route} value={option.route}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-frequency`} className="text-xs text-muted-foreground">
            Injections
          </Label>
          <select
            id={`${idPrefix}-frequency`}
            value={selection.perWeek}
            onChange={(e) => set({ perWeek: Number(e.target.value) })}
            className={SELECT_CLASS}
          >
            {INJECTION_FREQUENCIES.map((frequency) => (
              <option key={frequency.perWeek} value={frequency.perWeek}>
                {frequency.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  // No catalog leaves typing as the only way, so the field is shown without
  // asking for it.
  const typing = selection.choice === PERSONAL || options.length === 0

  return (
    <>
      {options.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-catalog`} className="text-xs text-muted-foreground">
            Dose
          </Label>
          <select
            id={`${idPrefix}-catalog`}
            value={selection.choice}
            onChange={(e) => set({ choice: e.target.value })}
            className={`${SELECT_CLASS} w-full`}
          >
            <option value="">Choose a dose…</option>
            {options.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.value}
              </option>
            ))}
            <option value={PERSONAL}>Personal dose…</option>
          </select>
        </div>
      )}

      {typing && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-personal`} className="text-xs text-muted-foreground">
            {options.length > 0 ? 'Personal dose' : 'New dose'}
          </Label>
          <DictationTextarea
            id={`${idPrefix}-personal`}
            rows={2}
            placeholder="Write the instruction out — e.g. Take 1/2 tablet (0.25mg) by mouth twice weekly"
            value={selection.personal}
            onValueChange={(personal) => set({ personal })}
          />
        </div>
      )}
    </>
  )
}

/** The house select, which has no primitive of its own — see `LabOrderDialog`. */
export const SELECT_CLASS =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
