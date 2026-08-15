'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { validateCompletion } from '@/lib/labReviews/completion'
import { shortTime } from '@/lib/labReviews/format'
import {
  DISPOSITION_HINTS,
  DISPOSITION_LABELS,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_LABELS,
  dispositionsFor,
  isDraftEmpty,
  type Disposition,
  type FollowUpKind,
  type ReviewDraft,
} from '@/lib/labReviews/reviewDraft'
import { describeDecision } from '@/lib/ai/decision'
import { completeLabReviewAction, saveReviewDraftAction } from '../actions'
import { AssistButton } from './AssistButton'
import { DoseChangePanel } from './DoseChangePanel'
import { NewMedicationPanel } from './NewMedicationPanel'
import type { CatalogMedication, DosageOption, Medication } from './types'

/**
 * The lab review flyout. Everything typed here is autosaved into
 * `lab_reviews.draft` and rehydrated when the flyout is next opened.
 *
 * Autosave is debounced rather than saved per keystroke, and the debounce is
 * generous: the point is not to lose a half-written clinical assessment to a
 * closed laptop, not to make every character durable. A save is also flushed on
 * close, because the most likely moment to lose an edit is typing a last sentence
 * and immediately hitting Escape.
 *
 * Which dispositions are offered depends on the patient's status — see
 * `dispositionsFor`. The provider does not get to choose between the onboarding
 * and active workflows, because the patient's situation decides which one is even
 * coherent.
 */

const DEBOUNCE_MS = 1200

type SaveState =
  | { kind: 'clean' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  /** Saved, but something needs saying — today, an audit entry that failed. */
  | { kind: 'warned'; message: string }
  /** Not saved. What is on screen is not on the server. */
  | { kind: 'error'; message: string }

export function ReviewModal({
  reviewId,
  patientName,
  patientStatus,
  collectionDate,
  medications,
  catalog,
  dosageOptions,
  initialDraft,
  draftUpdatedAt,
  onClose,
  onFinalized,
}: {
  reviewId: string
  patientName: string
  patientStatus: string | null
  collectionDate: string | null
  /** The patient's prescriptions, which are what a dose change picks from. */
  medications: Medication[]
  /** Everything a new medication can be, which is the whole catalog. */
  catalog: CatalogMedication[]
  /** Every dose in the catalog, for both a dose change and a new medication. */
  dosageOptions: DosageOption[]
  initialDraft: ReviewDraft
  draftUpdatedAt: string | null
  onClose: () => void
  /** Called once the review is finished. `warning` means it finished but a side
   *  effect — a flag, the status, the chart note — did not apply. */
  onFinalized: (warning?: string) => void
}) {
  const [draft, setDraft] = useState<ReviewDraft>(initialDraft)
  const [save, setSave] = useState<SaveState>(
    draftUpdatedAt && !isDraftEmpty(initialDraft)
      ? { kind: 'saved', at: draftUpdatedAt }
      : { kind: 'clean' }
  )

  /** Counts edits rather than watching `draft`, so the debounce cannot fire once
   *  on mount for a draft that was only rehydrated, not changed. */
  const [edits, setEdits] = useState(0)
  const [finalizing, setFinalizing] = useState(false)

  // The debounce timer and the close handler both need whatever the newest draft
  // is at the moment they run, not the one captured when they were created.
  const latest = useRef(initialDraft)
  const unsaved = useRef(false)

  const update = (patch: Partial<ReviewDraft>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    setDraft(next)
    unsaved.current = true
    setEdits((n) => n + 1)
  }

  const persist = useCallback(async () => {
    if (!unsaved.current) return

    const snapshot = latest.current
    setSave({ kind: 'saving' })
    const result = await saveReviewDraftAction(reviewId, JSON.stringify(snapshot))

    if (result.status === 'error') {
      setSave({ kind: 'error', message: result.message })
      return
    }

    // Only clear the dirty flag if nothing was typed while the save was in
    // flight; otherwise the newer edit would never get written.
    if (latest.current === snapshot) unsaved.current = false

    const warning = result.status === 'ok' ? result.warning : undefined
    setSave(
      warning
        ? { kind: 'warned', message: warning }
        : { kind: 'saved', at: new Date().toISOString() }
    )
  }, [reviewId])

  useEffect(() => {
    if (edits === 0) return
    const timer = setTimeout(() => void persist(), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [edits, persist])

  const close = () => {
    // Fire the pending save before unmounting. Not awaited: the server action is
    // already in flight and blocking the close on the round trip would make
    // Escape feel broken.
    void persist()
    onClose()
  }

  /** The same checks the server runs. Duplicated deliberately: this disables the
   *  button and names what is missing, while the server's copy is the one that
   *  actually protects the chart. */
  const problems = validateCompletion(draft)

  const finalize = async () => {
    setFinalizing(true)
    const result = await completeLabReviewAction(reviewId, JSON.stringify(latest.current))
    setFinalizing(false)

    if (result.status === 'error') {
      setSave({ kind: 'error', message: result.message })
      return
    }

    // Finished. The draft is now on the review row, so there is nothing pending.
    unsaved.current = false
    onFinalized(result.status === 'ok' ? result.warning : undefined)
  }

  const options = dispositionsFor(patientStatus)
  const followUp = draft.disposition === 'follow_up_needed'
  const showDose = draft.disposition === 'dose_change'
  const showDoseChanges = showDose || draft.doseChanges.length > 0
  const showInstructions = followUp && draft.followUpKinds.includes('patient_instructions')

  // Continuing as designed is a statement that nothing is changing, so there is
  // nothing to add. Medications added before the provider landed on it are still
  // shown, because they are a decision that was made and hiding them would leave
  // them on the record with no way to reach them — `validateCompletion` is what
  // insists they be removed.
  const continuing = draft.disposition === 'continue_protocol'
  const showNewMeds = !continuing || draft.newMedications.length > 0

  const toggleFollowUp = (kind: FollowUpKind) =>
    update({
      followUpKinds: draft.followUpKinds.includes(kind)
        ? draft.followUpKinds.filter((k) => k !== kind)
        : [...draft.followUpKinds, kind],
    })

  return (
    // Base UI's Dialog as a right-hand sheet, which is what gives Escape to
    // close and the aria wiring. `modal={false}` is what makes the lab document
    // behind it genuinely usable rather than merely visible: the default locks
    // page scroll and kills pointer events outside the popup, and the viewer is
    // taller than most screens with its own page and zoom controls, so a provider
    // has to be able to scroll and click it while writing the review. The price
    // is that focus is no longer trapped, which is the same trade.
    <Dialog
      open
      modal={false}
      onOpenChange={(open, details) => {
        // Escape and the Close button dismiss the flyout. An outside press is how
        // a provider reaches the document's page and zoom controls, and focus-out
        // fires as soon as they do, so neither may close a half-written review.
        if (open || details.reason === 'outside-press' || details.reason === 'focus-out') return
        close()
      }}
    >
      {/* The shared close button is absolutely positioned in the corner, which is
          where the save state has to be readable. Laying both out in the header
          row instead is what stops the X sitting on top of "Saved 10:38". */}
      <DialogContent
        side="right"
        showOverlay={false}
        showCloseButton={false}
        className="flex w-[480px] max-w-[92vw] flex-col gap-0 bg-card p-0 sm:max-w-[92vw]"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold tracking-tight">
              Lab review — {patientName}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
              {[collectionDate ? `Labs ${collectionDate}` : null, 'standardized review']
                .filter(Boolean)
                .join(' · ')}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SaveIndicator state={save} />
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label="Close review" />}
            >
              <XIcon />
            </DialogClose>
          </div>
        </div>

        <SaveBanner state={save} onRetry={() => void persist()} />

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-bold tracking-wider text-muted-foreground">
              DISPOSITION
            </legend>
            <div className="flex flex-col gap-1.5">
              {options.map((option) => (
                <DispositionOption
                  key={option}
                  option={option}
                  selected={draft.disposition === option}
                  onSelect={() => update({ disposition: option })}
                />
              ))}
            </div>
          </fieldset>

          {followUp && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-bold tracking-wider text-muted-foreground">
                WHAT THE FOLLOW-UP NEEDS
              </legend>
              <div className="flex flex-col gap-1.5">
                {FOLLOW_UP_KINDS.map((kind) => (
                  <label
                    key={kind}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.followUpKinds.includes(kind)}
                      onChange={() => toggleFollowUp(kind)}
                      className="size-3.5 accent-green-600"
                    />
                    {FOLLOW_UP_LABELS[kind]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Stays on screen under another disposition while changes are still
              recorded, because completion refuses them there and this is the only
              place they can be removed. */}
          {showDoseChanges && (
            <DoseChangePanel
              medications={medications}
              dosageOptions={dosageOptions}
              changes={draft.doseChanges}
              canChange={showDose}
              onChange={(doseChanges) => update({ doseChanges })}
            />
          )}

          {showInstructions && (
            <div className="flex flex-col gap-2">
              <Label
                htmlFor="new-instructions"
                className="text-xs font-bold tracking-wider text-muted-foreground"
              >
                PATIENT INSTRUCTIONS
              </Label>
              <Textarea
                id="new-instructions"
                rows={4}
                placeholder="Instructions for the patient (timing, titration, follow-up draw)…"
                value={draft.instructions}
                onChange={(e) => update({ instructions: e.target.value })}
              />
            </div>
          )}

          {/* Under every disposition but "continue protocol". Raising a dose and
              starting something new is one decision, and a provider who has
              picked "Dose change" still has to be able to record the second half
              of it. */}
          {showNewMeds && (
            <NewMedicationPanel
              catalog={catalog}
              medications={medications}
              dosageOptions={dosageOptions}
              added={draft.newMedications}
              canAdd={!continuing}
              onChange={(newMedications) => update({ newMedications })}
            />
          )}

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="areas-of-concern"
              className="text-xs font-bold tracking-wider text-muted-foreground"
            >
              AREAS OF CONCERN
            </Label>
            <Textarea
              id="areas-of-concern"
              rows={4}
              placeholder="Clinical concerns to document (e.g. Hct trending up — recheck CBC in 8 weeks)…"
              value={draft.concerns}
              onChange={(e) => update({ concerns: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="provider-note"
              className="text-xs font-bold tracking-wider text-muted-foreground"
            >
              NOTE FOR THE CHART
            </Label>
            <Textarea
              id="provider-note"
              rows={4}
              placeholder="Your assessment, in your own words…"
              value={draft.providerNote}
              onChange={(e) => update({ providerNote: e.target.value })}
            />
            {/* The structured half of the note is composed at completion, so the
                assistant is only ever drafting this field — and it is told the
                disposition, which lives nowhere but this unsaved draft. */}
            <AssistButton
              reviewId={reviewId}
              task="chart_note"
              value={draft.providerNote}
              onChange={(providerNote) => update({ providerNote })}
              instructions={describeDecision(draft)}
              disabled={finalizing}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label
              htmlFor="cs-instructions"
              className="text-xs font-bold tracking-wider text-muted-foreground"
            >
              INSTRUCTIONS FOR CUSTOMER SERVICE
            </Label>
            <Textarea
              id="cs-instructions"
              rows={3}
              placeholder="What CS should relay or handle (shipment changes, scheduling, patient outreach)…"
              value={draft.csInstructions}
              onChange={(e) => update({ csInstructions: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3.5">
          {problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2.5">
            <Button variant="outline" onClick={close} disabled={finalizing}>
              Close
            </Button>
            <Button
              onClick={finalize}
              disabled={finalizing || problems.length > 0}
              title={problems.length ? problems.join(' ') : undefined}
            >
              {finalizing ? 'Finalizing…' : 'Finalize lab review'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DispositionOption({
  option,
  selected,
  onSelect,
}: {
  option: Disposition
  selected: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5',
        selected ? 'border-green-600 bg-green-50' : 'border-border bg-card',
      ].join(' ')}
    >
      <input
        type="radio"
        name="disposition"
        value={option}
        checked={selected}
        onChange={onSelect}
        className="mt-1 size-3.5 accent-green-600"
      />
      <span>
        <span className="block text-[13px] font-semibold">{DISPOSITION_LABELS[option]}</span>
        <span className="block text-xs text-muted-foreground">{DISPOSITION_HINTS[option]}</span>
      </span>
    </label>
  )
}

/**
 * The one-word autosave status in the header. A failed save is the only state
 * that gets emphasis, because it is the only one the provider has to act on. The
 * reason why lives in `SaveBanner`, which has room for a sentence.
 */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'clean') return null

  const text =
    state.kind === 'saving'
      ? 'Saving…'
      : state.kind === 'saved'
        ? `Saved ${shortTime(state.at)}`
        : state.kind === 'warned'
          ? 'Saved'
          : 'Not saved'

  return (
    <span
      className={`shrink-0 text-xs ${
        state.kind === 'error' ? 'font-medium text-destructive' : 'text-muted-foreground'
      }`}
    >
      {text}
    </span>
  )
}

/** Why a save failed, or what was odd about one that succeeded. Full width,
 *  because a provider who cannot see the reason cannot decide whether to retype
 *  their assessment somewhere safer. */
function SaveBanner({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind !== 'error' && state.kind !== 'warned') return null

  const failed = state.kind === 'error'

  return (
    <p
      role="alert"
      className={`flex items-start gap-2 border-b px-5 py-2 text-xs font-medium ${
        failed
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <span>{state.message}</span>
      {failed && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto shrink-0 underline underline-offset-2 hover:no-underline"
        >
          Retry
        </button>
      )}
    </p>
  )
}
