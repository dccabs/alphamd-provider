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
import { DictationTextarea } from '@/components/ui/dictation-textarea'
import { Label } from '@/components/ui/label'
import { validateCompletion } from '@/lib/labReviews/completion'
import type { Consultation } from '@/lib/labReviews/consultations'
import { shortTime } from '@/lib/labReviews/format'
import {
  DISPOSITION_LABELS,
  dispositionHint,
  dispositionsFor,
  isDraftEmpty,
  workflowFor,
  type Disposition,
  type ReviewDraft,
} from '@/lib/labReviews/reviewDraft'
import {
  STEP_SKIPPED_LABELS,
  STEP_TITLES,
  allSettled,
  hasContent,
  isSettled,
  openStep,
  pinnedOpenStep,
  stepSummary,
  stepsFor,
  withSkip,
  withoutSkip,
  type ReviewStepId,
} from '@/lib/labReviews/reviewSteps'
import type { LabProviderOption, ScheduledLabOrder } from '@/lib/labOrders/queries'
import { describeDecision } from '@/lib/ai/decision'
import { saveReviewDraftAction } from '../actions'
import { ConsultPanel } from './ConsultPanel'
import { DoseChangePanel } from './DoseChangePanel'
import { FieldAssistButton } from './FieldAssistButton'
import { FinalizeSummaryDialog } from './FinalizeSummaryDialog'
import { LabOrdersPanel } from './LabOrdersPanel'
import { seedDiscounts } from '@/lib/labReviews/discountSeed'
import type { AssignedCoupon } from '@/lib/protocols/assignedCoupon'
import { DiscountsPanel } from './DiscountsPanel'
import { NewMedicationPanel } from './NewMedicationPanel'
import { ReviewStep } from './ReviewStep'
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
 *
 * ## Worked through one step at a time
 *
 * The disposition comes first and nothing else exists until it is chosen: every
 * step below depends on it, and the previous all-at-once form could offer a dose
 * change to a patient with no protocol. After that, `reviewSteps.ts` decides which
 * step is open, and each is settled either by recording something or by saying it
 * is not needed. Settled steps collapse to a summary row, so by the end the flyout
 * reads as a list of what the review decided.
 *
 * Whether every step has been settled gates the Finalize button here, and only
 * here. `validateCompletion` is deliberately left alone: it is also the server's
 * guard, and it is about whether the record will be *coherent* — a dose change
 * under the wrong disposition — not about whether the provider has clicked past
 * the labs step.
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
  patientFirstName,
  providerName,
  patientStatus,
  patientStatusId,
  patientState,
  patientEmail,
  patientGender,
  collectionDate,
  medications,
  catalog,
  dosageOptions,
  labProviders,
  scheduledLabs,
  consultations,
  cancellingLabOrder,
  onCancelScheduledLab,
  initialDraft,
  draftUpdatedAt,
  inNewsletter,
  assignedCoupon,
  subscriptionMedicationIds,
  onClose,
  onFinalized,
}: {
  reviewId: string
  patientName: string
  /** What the patient is called, for the one field written to them. */
  patientFirstName: string | null
  /** The signed-in provider, as the chart note will be signed. Shown in the
   *  summary so the note is previewed exactly as it will be written. */
  providerName: string
  patientStatus: string | null
  /** `user_list.status`, which decides which consultation types are suggested.
   *  The label above decides which dispositions are offered; this is the id
   *  behind it, and the two lists key on different things. */
  patientStatusId: number | null
  /** `user_list.state`, for the comped-labs restriction in NY and NJ. */
  patientState: string | null
  /** Where a booking link would be sent, which is what makes one possible. */
  patientEmail: string | null
  patientGender: string | null
  collectionDate: string | null
  /** The patient's prescriptions, which are what a dose change picks from. */
  medications: Medication[]
  /** Everything a new medication can be, which is the whole catalog. */
  catalog: CatalogMedication[]
  /** Every dose in the catalog, for both a dose change and a new medication. */
  dosageOptions: DosageOption[]
  /** Signing providers for a requisition — `lab_providers`. */
  labProviders: LabProviderOption[]
  /** What the patient already has on order, so a redraw is not ordered twice. */
  scheduledLabs: ScheduledLabOrder[]
  /** What the patient has already booked, so they are not asked twice. */
  consultations: Consultation[]
  cancellingLabOrder: boolean
  /** Cancelling an already-placed order happens immediately, unlike the orders
   *  composed here: the main app's cron may act on that row within minutes. */
  onCancelScheduledLab: (scheduledId: string) => void
  initialDraft: ReviewDraft
  draftUpdatedAt: string | null
  inNewsletter: boolean
  assignedCoupon: AssignedCoupon | null
  subscriptionMedicationIds: number[]
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
  /** The confirmation summary, over the flyout. */
  const [summary, setSummary] = useState(false)

  /**
   * Where the provider is looking. Wins over `openStep`, which treats any
   * content as settled — one character in the chart note would otherwise
   * collapse the box they are still typing in.
   *
   * Held here rather than in the draft because it is a cursor, not a decision:
   * where somebody is looking is not worth a round trip.
   */
  const [pin, setPin] = useState<ReviewStepId | null>(() =>
    openStep(initialDraft, workflowFor(patientStatus), {
      hasQuotedSubscription: initialDraft.newMedications.some(
        (med) =>
          med.medicationId !== null && subscriptionMedicationIds.includes(med.medicationId)
      ),
    })
  )

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

  useEffect(() => {
    if (latest.current.discountsSeeded) return
    const seeded = seedDiscounts(latest.current, {
      inNewsletter,
      coupon: assignedCoupon,
    })
    latest.current = seeded
    setDraft(seeded)
    unsaved.current = true
    setEdits((n) => n + 1)
    // Once per open: the draft is the source of truth after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const workflow = workflowFor(patientStatus)
  const problems = validateCompletion(draft, workflow)

  const options = dispositionsFor(patientStatus)
  const continuing = draft.disposition === 'continue_protocol'
  const declining = draft.disposition === 'treatment_not_recommended'

  const hasQuotedSubscription = draft.newMedications.some(
    (med) => med.medicationId !== null && subscriptionMedicationIds.includes(med.medicationId)
  )
  const stepsContext = { hasQuotedSubscription }
  const steps = stepsFor(draft, workflow, stepsContext)
  const current = pinnedOpenStep(draft, pin, workflow, stepsContext)
  const settled = allSettled(draft, workflow, stepsContext)

  const stateOf = (step: ReviewStepId): 'hidden' | 'open' | 'settled' => {
    if (!steps.includes(step)) return 'hidden'
    if (step === current) return 'open'
    return isSettled(step, draft) ? 'settled' : 'hidden'
  }

  /**
   * Past the open step.
   *
   * An empty step records a skip, which is what makes "not needed" a decision
   * rather than an omission. A step with something in it clears any skip it was
   * carrying, so one that was skipped, then filled, then emptied again is asked
   * about a second time instead of staying quietly settled.
   *
   * Reads the ref rather than `draft` for the same reason the autosave does: it is
   * whatever the newest draft is at the moment the click lands.
   */
  const advance = (step: ReviewStepId) => {
    const at = latest.current
    const skippedSteps = hasContent(step, at) ? withoutSkip(at, step) : withSkip(at, step)
    update({ skippedSteps })
    setPin(openStep({ ...at, skippedSteps }, workflow, stepsContext))
  }

  /** The plain props every step shares, so the seven call sites below stay
   *  readable. Handlers are passed separately, since a closure built per step in
   *  here would be a function created during render that reaches a ref. */
  const stepProps = (step: ReviewStepId) => ({
    step,
    title: STEP_TITLES[step],
    state: stateOf(step),
    summary: stepSummary(step, draft),
    skippedLabel: STEP_SKIPPED_LABELS[step],
    filled: hasContent(step, draft),
    last: step === steps[steps.length - 1],
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

        {/* Tighter than the gap the full-height sections wanted: most of what is on
            screen now is one-line settled rows, and 20px between them reads as a
            list of unrelated things rather than a review. */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-bold tracking-wider text-muted-foreground">
              DISPOSITION
            </legend>
            <div className="flex flex-col gap-1.5">
              {options.map((option) => (
                <DispositionOption
                  key={option}
                  option={option}
                  hint={dispositionHint(option, patientStatus)}
                  selected={draft.disposition === option}
                  onSelect={() => {
                    update({ disposition: option })
                    setPin(
                      openStep({ ...latest.current, disposition: option }, workflow, stepsContext)
                    )
                  }}
                />
              ))}
            </div>
          </fieldset>

          {/* Stays in the list under another disposition while changes are still
              recorded, because completion refuses them there and this is the only
              place they can be removed. */}
          <ReviewStep {...stepProps('doseChanges')} onOpen={setPin} onAdvance={advance}>
            <DoseChangePanel
              medications={medications}
              dosageOptions={dosageOptions}
              changes={draft.doseChanges}
              canChange={draft.disposition === 'dose_change'}
              onChange={(doseChanges) => update({ doseChanges })}
              patientGender={patientGender}
              patientState={patientState}
            />
          </ReviewStep>

          {/* Under every disposition but "continue protocol" and "treatment not
              recommended". Raising a dose and starting something new is one
              decision, and a provider who has picked "Dose change" still has to
              be able to record the second half of it. */}
          <ReviewStep {...stepProps('newMedications')} onOpen={setPin} onAdvance={advance}>
            <NewMedicationPanel
              catalog={catalog}
              medications={medications}
              dosageOptions={dosageOptions}
              added={draft.newMedications}
              canAdd={!continuing && !declining}
              onChange={(newMedications) => update({ newMedications })}
              patientGender={patientGender}
              patientState={patientState}
            />
          </ReviewStep>

          <ReviewStep {...stepProps('discounts')} onOpen={setPin} onAdvance={advance}>
            <DiscountsPanel
              draft={draft}
              assignedCoupon={assignedCoupon}
              onChange={(patch) => update(patch)}
            />
          </ReviewStep>

          {/* Under every disposition except declining treatment. Labs on an
              interval are how continuing as designed gets checked; a close-out
              does not order more. */}
          <ReviewStep {...stepProps('labOrders')} onOpen={setPin} onAdvance={advance}>
            <LabOrdersPanel
              patientState={patientState}
              providers={labProviders}
              scheduled={scheduledLabs}
              orders={draft.labOrders}
              cancelling={cancellingLabOrder}
              onCancelScheduled={onCancelScheduledLab}
              onChange={(labOrders) => update({ labOrders })}
            />
          </ReviewStep>

          {/* Also under every disposition, and next to the labs because the two
              are the same kind of decision: something the patient has to do,
              which the review sends them when it is approved. */}
          <ReviewStep {...stepProps('consultation')} onOpen={setPin} onAdvance={advance}>
            <ConsultPanel
              reviewId={reviewId}
              patientEmail={patientEmail}
              patientStatusId={patientStatusId}
              patientGender={patientGender}
              consultations={consultations}
              request={draft.consultation}
              onChange={(consultation) => update({ consultation })}
            />
          </ReviewStep>

          {/* The chart note comes before the two messages because both are
              written from it: once the assessment exists, the patient message and
              the customer service hand-off have something to relay. */}
          <ReviewStep
            {...stepProps('providerNote')}
            onOpen={setPin}
            onAdvance={advance}
            // Only this half of the note is ever drafted: the structured half —
            // the disposition, the doses, the medications added — is composed at
            // completion, and is handed over as recorded context so the prose
            // agrees with it.
            action={
              <FieldAssistButton
                field="providerNote"
                value={draft.providerNote}
                onChange={(providerNote) => update({ providerNote })}
                recorded={describeDecision(draft, { omit: 'providerNote' })}
              />
            }
          >
            <Label htmlFor="provider-note" className="sr-only">
              {STEP_TITLES.providerNote}
            </Label>
            <DictationTextarea
              id="provider-note"
              rows={5}
              placeholder="What you reviewed, what it showed, your assessment and the plan…"
              value={draft.providerNote}
              onValueChange={(providerNote) => update({ providerNote })}
            />
          </ReviewStep>

          <ReviewStep
            {...stepProps('csInstructions')}
            onOpen={setPin}
            onAdvance={advance}
            action={
              <FieldAssistButton
                field="csInstructions"
                value={draft.csInstructions}
                onChange={(csInstructions) => update({ csInstructions })}
                recorded={describeDecision(draft, { omit: 'csInstructions' })}
              />
            }
          >
            <Label htmlFor="cs-instructions" className="sr-only">
              {STEP_TITLES.csInstructions}
            </Label>
            <DictationTextarea
              id="cs-instructions"
              rows={4}
              placeholder="What CS should relay or handle (shipment changes, scheduling, patient outreach)…"
              value={draft.csInstructions}
              onValueChange={(csInstructions) => update({ csInstructions })}
            />
          </ReviewStep>

          {/* Last, and asked under every disposition. It used to appear only when
              a follow-up checkbox asked for it, which made telling the patient
              their labs were fine an opt-in — and a result nobody communicated is
              the risk this whole review exists to close. Now it is the step the
              review ends on, written once every other decision is made. */}
          <ReviewStep
            {...stepProps('patientMessage')}
            onOpen={setPin}
            onAdvance={advance}
            // The only field given the patient's name, because it is the only one
            // addressed to them. The chart note and the customer service box are
            // about the patient, and both read better as "the patient" than as a
            // first name.
            action={
              <FieldAssistButton
                field="patientMessage"
                value={draft.patientMessage}
                onChange={(patientMessage) => update({ patientMessage })}
                recorded={describeDecision(draft, { omit: 'patientMessage' })}
                firstName={patientFirstName}
              />
            }
          >
            <Label htmlFor="patient-message" className="sr-only">
              {STEP_TITLES.patientMessage}
            </Label>
            <DictationTextarea
              id="patient-message"
              rows={5}
              placeholder="What the patient is told — the result, what is changing, what they do next…"
              value={draft.patientMessage}
              onValueChange={(patientMessage) => update({ patientMessage })}
            />
          </ReviewStep>
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3.5">
          {problems.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
          {/* Named rather than left as a disabled button with no explanation. The
              outstanding step is usually on screen, but a provider who has
              scrolled up to change the disposition cannot see it. */}
          {problems.length === 0 && !settled && (
            <p className="text-xs text-muted-foreground">
              {current
                ? `Still to do: ${STEP_TITLES[current].toLowerCase()}.`
                : 'Choose a disposition to begin.'}
            </p>
          )}
          {settled && !draft.patientMessage.trim() && (
            <p className="text-xs font-medium text-destructive">
              NO Patient Message — the patient will not hear from you about this
              review.
            </p>
          )}
          <div className="flex items-center justify-between gap-2.5">
            <Button variant="outline" onClick={close}>
              Close
            </Button>
            <Button
              onClick={() => setSummary(true)}
              disabled={problems.length > 0 || !settled}
              title={problems.length ? problems.join(' ') : undefined}
            >
              Finalize lab review
            </Button>
          </div>
        </div>

        {/* Only ever opened with `problems` empty, which is the summary's
            precondition: it plans the completion to show it. */}
        {summary && (
          <FinalizeSummaryDialog
            reviewId={reviewId}
            draft={draft}
            patientName={patientName}
            patientEmail={patientEmail}
            patientFirstName={patientFirstName}
            providerName={providerName}
            onEdit={() => setSummary(false)}
            onChartSummary={(chartSummary) => update({ chartSummary })}
            onPatientMessage={(patientMessage) => update({ patientMessage })}
            onFinished={() => onFinalized()}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DispositionOption({
  option,
  hint,
  selected,
  onSelect,
}: {
  option: Disposition
  hint: string
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
        <span className="block text-xs text-muted-foreground">{hint}</span>
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
