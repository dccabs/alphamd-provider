// Explicit `.ts` specifiers: this module is exercised by `npm test`, which runs
// TypeScript through Node's type stripping and needs the real extension. See the
// note on `allowImportingTsExtensions` in tsconfig.json.
import { eventTypeById } from '../consultations/eventTypes.ts'
import {
  consultLine,
  patientBookingBlock,
  validateConsultRequest,
} from '../consultations/request.ts'
import { orderLine, orderWhen, validateOrder, type LabOrder } from '../labOrders/order.ts'
import { FLAG, PATIENT_STATUS } from './clinicalIds.ts'
import { DISPOSITION_LABELS, type Disposition, type ReviewDraft } from './reviewDraft.ts'

/**
 * What finishing a lab review means, decided as a pure function.
 *
 * Completion is the highest-risk write in the portal: it clears a flag, may add
 * others, may change the patient's status, and writes a note onto the chart. So
 * the *decision* about which of those apply is separated from the *doing* of them
 * and unit-tested here, where every disposition can be checked without touching
 * the database.
 *
 * This reproduces what the main app's now-frozen
 * `PATCH /api/admin/lab-reviews/[id]/status` did on finish — clear "Needs lab
 * review", optionally add "Labs reviewed, no changes recommended", write a plain
 * text note to `patient_notes_private` — and extends it with the disposition the
 * doc asks for. The note is deliberately plain text, matching every other
 * server-side note writer: HTML is never built from provider free text.
 */

/**
 * The structured half of a completion, for `lab_reviews.disposition_detail`.
 *
 * Written as jsonb, but typed here rather than left as a bag of unknowns: it is
 * the machine-readable record of what was decided, and it is also what the
 * confirmation screen reads to list the decision back to the provider. Every
 * field has already been filtered and trimmed — a dose change that appears here
 * is one that will be acted on.
 */
export type DispositionDetail = {
  disposition: Disposition
  doseChanges: {
    medicationId: number | null
    medication: string
    /** Null when no previous dose was recorded, or when only the route changed. */
    from: string | null
    value: string
    sig: string | null
  }[]
  newMedications: {
    medicationId: number | null
    name: string
    dose: string
    sig: string | null
    /** The figure the protocol was priced on, when there was one. Recorded here
     *  because the quote the patient receives is derived from it. */
    dosageMg: number | null
  }[]
  /** The orders placed at completion, as composed. Kept whole rather than
   *  summarised: `scheduled_lab_requisitions` records what was sent, and this
   *  records what the review decided to send, which is what a later reader needs
   *  when the two disagree. */
  labOrders: LabOrder[]
  /** The appointment the patient was invited to book, resolved to its name so a
   *  later reader is not left holding a Calendly UUID. */
  consultation: {
    eventTypeId: string
    eventTypeName: string
    message: string | null
  } | null
  patientMessage: string | null
  csInstructions: string | null
}

/**
 * What sending the recommended protocol came to, as far as the review's text is
 * concerned.
 *
 * A deliberately thin type, declared here rather than imported from
 * `lib/protocols`, so this module stays pure and stays ignorant of the pricing
 * catalog. `protocolOutcome` in `protocols/protocolPlan.ts` produces it; the two
 * callers are the server that sends the protocol and the confirmation screen that
 * previews it, and both hand the same value in so the preview and the record
 * cannot disagree.
 *
 * Its presence is what tells the note that a price went out. Without it every
 * added medication would have to be described as though pricing were somebody
 * else's problem, which was true until it wasn't.
 */
export type ProtocolOutcome =
  | {
      kind: 'quote'
      /** The breakdown the patient is emailed, line for line. */
      lines: string[]
      /** Formatted, e.g. `$137.39`. */
      total: string
      /** The one caveat every quote from this portal carries. */
      caveat: string
    }
  /** Nothing was sent; a human prices it. The reasons are written for that human. */
  | { kind: 'handed-off'; reasons: string[] }

export type CompletionPlan = {
  /** One line for `lab_reviews.resolution`, which the queue already displays. */
  resolution: string
  /** The chart note body. The provider's note, then the AI summary (or a
   *  one-line fallback if none has been generated yet). */
  note: string
  /** Structured facts this review produced — the source the AI summary is
   *  written from. Not written to the chart. */
  events: string
  detail: DispositionDetail
  addFlagIds: number[]
  /** Deleted, not deactivated — matching the main app. The flag carries no
   *  history; `lab_reviews` is the record. */
  removeFlagIds: number[]
  /** `user_list.status`, or null to leave it alone. */
  patientStatusId: number | null
}

/**
 * Structural problems that must be fixed before a review can be finished.
 *
 * These check that the record will be *coherent*, not that the clinician made a
 * good decision. A dose change with no medication named, or a follow-up with
 * nothing to follow up on, is a record nobody can act on later.
 */
export function validateCompletion(draft: ReviewDraft): string[] {
  const problems: string[] = []

  if (!draft.disposition) {
    problems.push('Choose a disposition before finishing.')
    // Everything below is disposition-specific, so there is nothing else to say.
    return problems
  }

  if (draft.disposition === 'dose_change' && recordedChanges(draft).length === 0) {
    problems.push('Record the dose change: choose a medication and set its new dose.')
  }

  // Reachable by recording one and then landing on another disposition. The
  // changes are left in the draft rather than dropped — a dose a provider worked
  // out is not something to discard quietly — so finishing has to stop until they
  // are either removed or claimed by the right disposition.
  if (draft.disposition !== 'dose_change' && recordedChanges(draft).length > 0) {
    problems.push(
      'A dose change is only recorded under the Dose change disposition. Remove it, or choose Dose change.'
    )
  }

  // "No changes; continue as prescribed" and a new prescription cannot both be
  // true. Reachable by adding one and then landing on this disposition, and worth
  // catching, because the note it would write contradicts itself.
  if (draft.disposition === 'continue_protocol' && namedMedications(draft).length > 0) {
    problems.push(
      'Continuing the protocol as designed cannot also add a medication. Remove it, or choose another disposition.'
    )
  }

  // A follow-up with nothing to follow up on is a record nobody can act on. This
  // used to be checked against a group of checkboxes that declared what the
  // follow-up needed; the declaration could disagree with what was actually
  // recorded, so it is now checked against the recorded things themselves.
  if (draft.disposition === 'follow_up_needed' && !followUpArtifacts(draft)) {
    problems.push(
      'Say what the follow-up is: a message for the patient, instructions for customer service, a lab order, a consultation, or a new medication.'
    )
  }

  problems.push(...validateConsultRequest(draft.consultation))

  // An order that lost its provider or its tests can only come from a draft saved
  // by an older build. Refusing it by name beats placing a requisition for
  // nothing. The state-dependent rules — comped labs in New York and New Jersey —
  // are checked on the server against the patient's real state.
  draft.labOrders.forEach((order, index) => {
    for (const problem of validateOrder(order, null)) {
      problems.push(`Lab order ${index + 1}: ${problem}`)
    }
  })

  return problems
}

/** Whether anything was recorded that a follow-up could consist of. Asking the
 *  patient in to be seen counts: that is the follow-up, not a note about one. */
function followUpArtifacts(draft: ReviewDraft): boolean {
  return Boolean(
    draft.patientMessage.trim() ||
      draft.csInstructions.trim() ||
      draft.labOrders.length ||
      draft.consultation ||
      namedMedications(draft).length
  )
}

function namedMedications(draft: ReviewDraft) {
  return draft.newMedications.filter((m) => m.name.trim())
}

/** The changes that say something. A row with a medication and no dose, or the
 *  reverse, describes nothing anyone could act on. */
function recordedChanges(draft: ReviewDraft) {
  return draft.doseChanges.filter((change) => change.medication.trim() && change.value.trim())
}

/**
 * The two sentences a dose change becomes: one for the chart, one for whoever
 * has to act on it.
 *
 * Both are composed here rather than at each call site because the confirm
 * dialog shows the provider exactly these strings before they commit. If the
 * preview and the record came from two different pieces of code they would
 * eventually disagree, and the thing that disagreed would be a prescription.
 *
 * Returns null when there is no change to describe, so callers can drop the
 * lines rather than emit a header with nothing under it.
 */
export function doseChangeLines(change: {
  medication: string
  from: string
  value: string
  sig: string
}): { chart: string; cs: string } | null {
  const medication = change.medication.trim()
  const value = change.value.trim()
  if (!medication || !value) return null

  const sig = change.sig.trim()

  // A route or a schedule can change while the weekly dose stays put. Saying
  // "160mg/week (was 160mg/week)" would read as an error; what actually changed
  // is in the instruction.
  const previous = change.from.trim()
  const from = previous === value ? '' : previous

  return {
    chart: [
      `Dose change: ${medication} — ${value}`,
      from ? ` (was ${from})` : '',
      sig ? `. ${sig}` : '',
    ].join(''),
    // Written for a reader who is not a clinician: what changed, and what they
    // have to do about it.
    cs: [
      `Dose change — ${medication}: ${sentence(from ? `${from} → ${value}` : value)}`,
      sig ? `New sig: ${sig}` : null,
      'Update the prescription and the next shipment.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/**
 * The two sentences adding a medication becomes.
 *
 * The shape of `doseChangeLines`, for the same reason: the dialog previews these
 * exact strings, and a preview composed anywhere but here would eventually
 * disagree with the record.
 *
 * A medication with no dose still returns lines. It can only come from a draft
 * saved before the picker existed, and dropping it would lose a decision the
 * provider made.
 */
export function newMedicationLines(med: {
  name: string
  dose: string
  sig: string
}): { chart: string; cs: string } | null {
  const name = med.name.trim()
  if (!name) return null

  const dose = med.dose.trim()
  const sig = med.sig.trim()

  return {
    chart: sentence(
      [`New medication: ${name}`, dose ? ` — ${sentence(dose)}` : '', sig ? ` ${sentence(sig)}` : ''].join('')
    ),
    cs: [
      dose ? `New medication — ${name}: ${sentence(dose)}` : `New medication — ${name}.`,
      sig ? `Sig: ${sentence(sig)}` : null,
      'Add it to the prescription and the next shipment.',
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/** A clause ended with exactly one full stop. Catalog doses are whole sentences
 *  and bring their own — `1.00mg - Take 1/2 tablet (0.50mg) by mouth twice
 *  weekly.` — while a dose level like `160mg/week` does not. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** Nothing outside the dose-change disposition, which `validateCompletion` has
 *  already refused, so a stranded change cannot reach the chart. */
function doseChangesFor(draft: ReviewDraft) {
  return draft.disposition === 'dose_change' ? recordedChanges(draft) : []
}

/**
 * Everything customer service has to read, as one block.
 *
 * A dose change and an added medication lead it whether or not the provider typed
 * anything, because somebody downstream has to update a prescription and the
 * chart note is where they read what to do. Composed rather than appended into
 * the provider's own text, so changing the dose twice cannot leave a stale
 * instruction behind.
 *
 * Comes back empty when nobody downstream has to act, so callers can drop the
 * header rather than emit one with nothing under it.
 *
 * Labs and a consultation are not in this block. Those go on the chart
 * (`chartActionLines`) and out to the Patient; customer service has nothing to
 * do with either once they are sent.
 */
function customerServiceBlock(draft: ReviewDraft, protocol: ProtocolOutcome | null): string {
  const changes = doseChangesFor(draft)
    .map(doseChangeLines)
    .filter((change) => change !== null)
  const added = namedMedications(draft)
    .map(newMedicationLines)
    .filter((medication) => medication !== null)

  return [
    ...changes.map((change) => change.cs),
    ...added.map((medication) => medication.cs),
    ...protocolInstructions(protocol),
    draft.csInstructions.trim() || null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * What customer service has to know about the money.
 *
 * A quote is *not* an action for them — the patient approves and pays on their own
 * protocol page — but it is the thing the patient rings about, so it is stated
 * along with the caveat that would otherwise cost them a refund conversation.
 *
 * A handoff is the opposite: a real task, and the only reason the medication ever
 * reaches a shipment. It leads with the imperative for that reason.
 */
function protocolInstructions(protocol: ProtocolOutcome | null): string[] {
  if (!protocol) return []

  if (protocol.kind === 'handed-off') {
    return [
      [
        'Recommended protocol — price this one by hand and send it; it could not be priced automatically:',
        ...protocol.reasons.map((reason) => `  ${reason}`),
      ].join('\n'),
    ]
  }

  return [
    `Recommended protocol — the patient is emailed a quote for ${protocol.total} due today. They approve and pay on their protocol page, and it ships after that; nothing to do here unless they ask. ${protocol.caveat}`,
  ]
}

/**
 * The three readers of a finished review, each handed the text they will get.
 *
 * Composed here rather than in the flyout because the confirmation screen shows
 * the provider these exact strings before they approve them, and this is the
 * same reason `doseChangeLines` lives here: a preview assembled anywhere but
 * beside the record would eventually disagree with it, and what disagreed would
 * be a prescription. `chart` is literally the note `planCompletion` writes.
 *
 * The chart is the provider's own note plus a short summary of what else
 * happened, then a line each for labs or a consultation when those actually
 * go out. The patient and customer service texts stay their own documents.
 */
export type ReviewAudiences = {
  /** Verbatim what the patient is sent. Empty when nothing was written. */
  patient: string
  /** The composed dose and medication lines, then the provider's own hand-off. */
  customerService: string
  /** The chart note, exactly as it will be written. */
  chart: string
  /** Structured facts the chart summary is written from. */
  events: string
}

export function reviewAudiences(
  draft: ReviewDraft,
  providerName: string,
  protocol: ProtocolOutcome | null = null
): ReviewAudiences {
  const plan = planCompletion(draft, providerName, protocol)
  return {
    patient: patientText(draft),
    customerService: customerServiceBlock(draft, protocol),
    chart: plan.note,
    events: plan.events,
  }
}

/**
 * What the patient reads: the provider's own words, then how to book if they are
 * being asked in.
 *
 * The booking paragraph is appended rather than typed because the URL is minted by
 * the dialog and never shown to the provider, so it cannot be in the box they wrote
 * in. It is also the reason a staged consultation means the patient hears something
 * even when the message box was left empty — they cannot be asked to book and told
 * nothing about how.
 *
 * The link is **masked** here. This text is previewed before approval and recorded
 * on the chart, and neither is a delivery: a single-use URL would be dead by the
 * time anyone read the note, and showing one before approval would be a link that
 * could be sent without it. Whatever eventually delivers this message substitutes
 * the real one by calling `patientBookingBlock` with `consultation.bookingUrl`.
 */
function patientText(draft: ReviewDraft): string {
  const written = draft.patientMessage.trim()
  if (!draft.consultation) return written

  const booking = patientBookingBlock(draft.consultation, null)
  return written ? `${written}\n\n${booking}` : booking
}

/**
 * What this review did, as structured facts. The AI summary is written from
 * this; the chart itself only stores the provider's note plus that summary.
 */
export function completionEvents(
  draft: ReviewDraft,
  providerName: string,
  protocol: ProtocolOutcome | null,
  label: string
): string {
  const lines: string[] = [`Lab review completed by ${providerName}. Disposition: ${label}.`]
  const changes = doseChangesFor(draft)
    .map(doseChangeLines)
    .filter((change) => change !== null)
  const added = namedMedications(draft)
    .map(newMedicationLines)
    .filter((medication) => medication !== null)

  for (const change of changes) lines.push(change.chart)

  for (const order of draft.labOrders) lines.push(`Labs ordered: ${orderLine(order)}`)

  if (draft.consultation) {
    lines.push(`Consultation requested: ${consultLine(draft.consultation)}`)
  }

  if (draft.patientMessage.trim()) {
    lines.push('Patient was emailed findings of lab results with a short summary.')
  }

  for (const medication of added) lines.push(medication.chart)

  if (protocol?.kind === 'quote') {
    lines.push(`Recommended protocol sent — ${protocol.total} due today. ${protocol.caveat}`)
  }
  if (protocol?.kind === 'handed-off') {
    lines.push(
      [
        'A recommended protocol was not sent: it could not be priced automatically.',
        ...protocol.reasons.map((reason) => `  ${reason}`),
      ].join('\n')
    )
  }

  const customerService = customerServiceBlock(draft, protocol)
  if (customerService) lines.push(`For customer service: ${customerService}`)

  return lines.join('\n')
}

/**
 * Lab orders and a consultation, as they should appear on the chart note.
 *
 * The AI summary is written from the events and can drop these to stay short.
 * Appended after it so a review that actually placed labs or sent a booking
 * link still says so on the chart. Empty when neither was chosen.
 */
export function chartActionLines(draft: ReviewDraft): string[] {
  const lines = draft.labOrders.map((order) => `Labs ordered: ${orderLine(order)}`)
  if (draft.consultation) {
    lines.push(`Consultation requested: ${consultLine(draft.consultation)}`)
  }
  return lines
}

export function planCompletion(
  draft: ReviewDraft,
  providerName: string,
  protocol: ProtocolOutcome | null = null
): CompletionPlan {
  const disposition = draft.disposition
  if (!disposition) {
    throw new Error('planCompletion called without a disposition; validate first')
  }

  const label = DISPOSITION_LABELS[disposition]
  const meds = namedMedications(draft)

  // Every completion clears "Needs lab review" — that is what completing means.
  const removeFlagIds = [FLAG.needsLabReview]
  const addFlagIds: number[] = []
  let patientStatusId: number | null = null

  switch (disposition) {
    case 'continue_protocol':
      // The only disposition where "no changes recommended" is a true statement.
      addFlagIds.push(FLAG.labsReviewedNoChanges)
      break

    case 'dose_change':
    case 'follow_up_needed':
      // Somebody downstream has to act — update a prescription, order labs, relay
      // instructions. The flag is what makes that visible outside this review.
      addFlagIds.push(FLAG.followUpRequired)
      break

    case 'treatment_not_recommended':
      patientStatusId = PATIENT_STATUS.treatmentNotRecommended
      break

    case 'treatment_recommended':
      // Deliberately *not* set to "Pricing sent to PT", even now that this portal
      // can send pricing. Recommending treatment is not the same as having sent a
      // quote, and whether one goes out depends on whether it could be priced —
      // which this pure function has no way of knowing. `sendProtocol` sets the
      // status itself, once a quote is actually in the patient's inbox.
      addFlagIds.push(FLAG.followUpRequired)
      break
  }

  const events = completionEvents(draft, providerName, protocol, label)
  const fallback = `Lab review completed by ${providerName}. Disposition: ${label}.`
  const note = [
    draft.providerNote.trim(),
    draft.chartSummary.trim() || fallback,
    ...chartActionLines(draft),
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    resolution: resolutionLine(draft, label),
    note,
    events,
    detail: {
      disposition,
      doseChanges: doseChangesFor(draft).map((change) => ({
        medicationId: change.medicationId,
        medication: change.medication.trim(),
        from: change.from.trim() || null,
        value: change.value.trim(),
        sig: change.sig.trim() || null,
      })),
      newMedications: meds.map((m) => ({
        medicationId: m.medicationId,
        name: m.name.trim(),
        dose: m.dose.trim(),
        sig: m.sig.trim() || null,
        dosageMg: m.dosageMg,
      })),
      labOrders: draft.labOrders,
      consultation: draft.consultation && {
        eventTypeId: draft.consultation.eventTypeId,
        eventTypeName: eventTypeById(draft.consultation.eventTypeId)?.name ?? 'Unknown type',
        message: draft.consultation.message.trim() || null,
      },
      patientMessage: draft.patientMessage.trim() || null,
      csInstructions: draft.csInstructions.trim() || null,
    },
    addFlagIds,
    removeFlagIds,
    patientStatusId,
  }
}

/**
 * `resolution` predates the structured disposition and is still what the queue
 * shows, so it stays a single readable line. The most specific thing available
 * goes after the label — a dose is more use at a glance than the label alone.
 */
function resolutionLine(draft: ReviewDraft, label: string): string {
  const changes = doseChangesFor(draft)
  if (changes.length) {
    // Semicolons rather than a count: two medications and their new doses still
    // fit a queue row, and a row that says "2 medications" sends the reader into
    // the review to find out which.
    return `${label}: ${changes
      .map((change) => `${change.medication.trim()} — ${change.value.trim()}`)
      .join('; ')}`
  }

  // When labs were ordered, that is the most specific thing about the review. The
  // date rather than the panel: a queue row has no space for fifteen test names,
  // and "labs in 12 weeks" is what a reader is scanning for.
  if (draft.labOrders.length) {
    return `${label}: labs — ${draft.labOrders.map((order) => orderWhen(order)).join('; ')}`
  }

  // Behind labs because a draw the patient must pay for and attend is the more
  // consequential of the two, and ahead of the note because "booking link sent"
  // is a state a reader can act on where a first sentence is only prose.
  if (draft.consultation) {
    const eventType = eventTypeById(draft.consultation.eventTypeId)
    return `${label}: consultation — ${eventType?.name ?? 'type no longer offered'}`
  }

  const firstLine = draft.providerNote.trim().split('\n')[0]?.trim()
  return firstLine ? `${label}: ${firstLine}` : label
}
