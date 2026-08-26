import 'server-only'

import { ROLE, type ProviderAccess } from '@/lib/authz'
import { consultProblems, requestConsultation } from '@/lib/consultations/mutations'
import type { ConsultRequest } from '@/lib/consultations/request'
import { labOrderProblems, scheduleLabOrder } from '@/lib/labOrders/mutations'
import { orderWhen, type LabOrder } from '@/lib/labOrders/order'
import { addPatientFlag } from '@/lib/patients/flags'
import {
  handoffLines,
  planProtocolFor,
  protocolProblems,
  sendProtocol,
  type ProtocolSendResult,
} from '@/lib/protocols/mutations'
import { protocolOutcome, type ProtocolPlan } from '@/lib/protocols/protocolPlan'
import { createAdminClient } from '@/lib/supabase/admin'
import { FLAG } from './clinicalIds'
import {
  planCompletion,
  validateCompletion,
  type CompletionPlan,
} from './completion'
import { logLabReviewEvent, resolveActor, type Actor } from './events'
import {
  summarizeNeedsAttention,
  transfersOwnership,
  validateEscalation,
  type Escalation,
} from './needsAttention'
import { getPatientHeader } from './queries'
import { DISPOSITION_LABELS, workflowFor, type ReviewDraft } from './reviewDraft'

/**
 * Every write this portal makes to a lab review.
 *
 * **This is the first module in the repo that writes to the database.** Reads
 * were already authorized in application code because RLS on these tables checks
 * a dead column (see the README), and the same is now true of writes — with the
 * consequence that a mistake here is a mistake on somebody's chart, not just a
 * blank panel.
 *
 * Three rules hold for everything below:
 *
 *  1. **The caller has already proven access.** These functions take a
 *     `ProviderAccess`, which only `checkProviderAccess()` can produce, so an
 *     unauthenticated path cannot reach them by forgetting a guard.
 *  2. **The review is re-read before it is changed.** The page that rendered the
 *     button may be minutes stale, and a provider must not silently take over a
 *     review somebody else started in the meantime.
 *  3. **Nothing changes without an audit entry.** Every function here appends to
 *     `lab_review_events`, and reports it when that append fails. Draft autosave
 *     is the one documented exception — see `saveReviewDraft`.
 */

export type MutationResult = { ok: true; warning?: string } | { ok: false; error: string }

/** The subset of a review a mutation needs to decide whether it may proceed. */
type ReviewGuardRow = {
  id: string
  /** Whose chart this decision belongs to. Read from the review, never from the
   *  request — the review is the only trustworthy statement of it. */
  patientId: string
  status: string
  assignedTo: string | null
  startedAt: string | null
  disposition: string | null
}

async function loadForMutation(reviewId: string): Promise<ReviewGuardRow | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lab_reviews')
    .select('id, patient_id, status, assigned_to, started_at, disposition')
    .eq('id', reviewId)
    .maybeSingle()
  if (error) throw new Error(`lab_reviews lookup failed: ${error.message}`)
  if (!data) return null

  return {
    id: data.id as string,
    patientId: data.patient_id as string,
    status: data.status as string,
    assignedTo: (data.assigned_to as string | null) ?? null,
    startedAt: (data.started_at as string | null) ?? null,
    disposition: (data.disposition as string | null) ?? null,
  }
}

/** Shared tail for a successful write: record it, and say so if the record
 *  failed. See `logLabReviewEvent` for why this is not atomic. */
async function recorded(
  entry: Parameters<typeof logLabReviewEvent>[0]
): Promise<MutationResult> {
  const logged = await logLabReviewEvent(entry)
  if (!logged.ok) {
    return {
      ok: true,
      warning: `Saved, but the audit log entry failed (${logged.error}). Tell an administrator — this change is not in the review's history.`,
    }
  }
  return { ok: true }
}

async function nameOf(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('user_list')
    .select('first_name, last_name')
    .eq('user_id', userId)
    .maybeSingle()

  return [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() || 'another provider'
}

/**
 * Claim a review and start the clock.
 *
 * `started_at` and `started_by` are written **only when unset**. The doc wants
 * real per-review duration for staffing planning, and re-opening the flyout
 * after lunch must not reset the start time — the first start is the honest one.
 * Re-starting your own in-progress review is therefore a no-op that succeeds, so
 * the button can always just open the flyout.
 */
export async function startLabReview(
  access: ProviderAccess,
  reviewId: string
): Promise<MutationResult> {
  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is already finished.' }
  }

  if (review.assignedTo && review.assignedTo !== access.userId) {
    const holder = await nameOf(review.assignedTo)
    return {
      ok: false,
      error: `${holder} is already working on this review. Use reassign if it needs to move.`,
    }
  }

  // Already mine and already running: nothing to write, so the button can just
  // open the flyout.
  if (review.startedAt && review.assignedTo === access.userId) return { ok: true }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const now = new Date().toISOString()

  const patch: Record<string, string> = {
    assigned_to: access.userId,
    updated_at: now,
  }
  // Only stamp the start on the first one. Reassignment can bring a review to a
  // second provider, and overwriting the original start would erase the duration
  // the doc wants for staffing planning.
  if (!review.startedAt) {
    patch.started_at = now
    patch.started_by = access.userId
  }

  const claim = admin.from('lab_reviews').update(patch).eq('id', reviewId)

  // Optimistic concurrency, as a compare-and-swap on the assignment just read:
  // two providers can open the same queue row, and whoever writes second must not
  // silently take it over. The checks above leave only two possibilities — the
  // review is unclaimed, or it is already ours — so this needs no OR group, which
  // is just as well: PostgREST qualifies an OR'd column with its table name, and
  // that name is not in scope in the SQL it generates for an update.
  const { data: updated, error } = await (review.assignedTo === null
    ? claim.is('assigned_to', null)
    : claim.eq('assigned_to', review.assignedTo)
  ).select('id')
  if (error) return { ok: false, error: `Could not start this review: ${error.message}` }

  if (!updated?.length) {
    const holder = review.assignedTo ? await nameOf(review.assignedTo) : 'Another provider'
    return { ok: false, error: `${holder} claimed this review a moment ago. Reload the page.` }
  }

  return recorded({
    labReviewId: reviewId,
    eventType: 'started',
    actor,
    summary: `${actor.displayName} started the lab review`,
    fromStatus: review.status,
    toStatus: review.status,
    metadata: { assignedTo: access.userId },
  })
}

/**
 * Hand a review to a different provider.
 *
 * **A lab review is only ever assigned to a provider.** That is the doc's rule,
 * and it is enforced here rather than only in the picker, because the target id
 * arrives from the browser. `assigned_to` has a foreign key to `user_list`, which
 * stops a nonexistent user but happily accepts a patient.
 */
export async function reassignLabReview(
  access: ProviderAccess,
  reviewId: string,
  toUserId: string
): Promise<MutationResult> {
  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is already finished.' }
  }
  if (review.assignedTo === toUserId) return { ok: true }

  if (!(await holdsProviderRole(toUserId))) {
    return { ok: false, error: 'A lab review can only be assigned to a provider.' }
  }

  const admin = createAdminClient()
  const [actor, toName] = await Promise.all([resolveActor(access), nameOf(toUserId)])
  const fromName = review.assignedTo ? await nameOf(review.assignedTo) : null

  const { data: updated, error } = await admin
    .from('lab_reviews')
    .update({ assigned_to: toUserId, updated_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id')
  if (error) return { ok: false, error: `Could not reassign this review: ${error.message}` }
  if (!updated?.length) return { ok: false, error: 'This review no longer exists.' }

  return recorded({
    labReviewId: reviewId,
    eventType: review.assignedTo ? 'reassigned' : 'assigned',
    actor,
    summary: fromName
      ? `${actor.displayName} reassigned the review from ${fromName} to ${toName}`
      : `${actor.displayName} assigned the review to ${toName}`,
    fromStatus: review.status,
    toStatus: review.status,
    metadata: { from: review.assignedTo, to: toUserId },
  })
}

/**
 * Persist an in-progress review.
 *
 * Called on a debounce as the provider types, which is why this is the one write
 * that does **not** append an audit entry per call: a single review would
 * otherwise produce hundreds of `draft_saved` rows and bury the entries that
 * matter. What gets recorded instead is the moment the clinical decision
 * changes — `disposition` moving to a new value emits `disposition_set`, so the
 * trail shows the decisions without the keystrokes.
 *
 * `disposition` is mirrored out of the jsonb into its own column because the
 * check constraint and any future reporting need it queryable, and because it is
 * the field completion validates against.
 */
export async function saveReviewDraft(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft
): Promise<MutationResult> {
  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is finished; it can no longer be edited.' }
  }
  // Only the provider holding the review may write to it. An unassigned review
  // is writable so that a draft is never lost to a race with the claim.
  if (review.assignedTo && review.assignedTo !== access.userId) {
    const holder = await nameOf(review.assignedTo)
    return { ok: false, error: `${holder} holds this review now; your changes were not saved.` }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { error } = await admin
    .from('lab_reviews')
    .update({
      draft,
      draft_updated_at: now,
      disposition: draft.disposition,
      updated_at: now,
    })
    .eq('id', reviewId)
  if (error) return { ok: false, error: `Could not save your progress: ${error.message}` }

  if (draft.disposition === review.disposition) return { ok: true }

  const actor = await resolveActor(access)

  return recorded({
    labReviewId: reviewId,
    eventType: 'disposition_set',
    actor,
    summary: draft.disposition
      ? `${actor.displayName} set the disposition to ${DISPOSITION_LABELS[draft.disposition]}`
      : `${actor.displayName} cleared the disposition`,
    fromStatus: review.status,
    toStatus: review.status,
    metadata: { from: review.disposition, to: draft.disposition },
  })
}

/**
 * Finish a review: record the outcome, then apply its clinical side effects.
 *
 * The draft is passed in and written as part of the same update, rather than read
 * from the column. The provider can hit Finalize between a keystroke and the
 * autosave debounce, and finishing a review against a draft that is one sentence
 * stale is not acceptable — the note it produces goes on a chart.
 *
 * The order matters. `lab_reviews` is updated **first**, and only then are the
 * flags, status and chart note applied. There is no transaction across these
 * tables, so something has to be the source of truth if the process dies halfway,
 * and the review row is the only one that records the whole decision. A side
 * effect that fails comes back as a `warning`, not an error: the review *is*
 * finished, and telling the provider it failed would send them to do it twice.
 *
 * Lab orders are the exception that proves the rule. They are the one side effect
 * that reaches the patient's inbox and their wallet, so they are checked against
 * the patient's real state **before** the review row is touched: a completion that
 * cannot place its orders refuses with nothing written, while the provider can
 * still remove the order or fix the patient's record. Only the placement itself
 * happens afterwards, where a failure is a warning like any other.
 */
export async function completeLabReview(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft
): Promise<MutationResult> {
  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is already finished.' }
  }
  if (review.assignedTo && review.assignedTo !== access.userId) {
    const holder = await nameOf(review.assignedTo)
    return { ok: false, error: `${holder} holds this review. It cannot be finished from here.` }
  }

  const header = await getPatientHeader(review.patientId)
  const problems = validateCompletion(draft, workflowFor(header?.status ?? null))
  if (problems.length) return { ok: false, error: problems.join(' ') }

  // Priced before anything is written, for two reasons: the preflight below needs
  // to know whether a quote is going out, and the note written further down has to
  // say what the patient was quoted. Held and passed along rather than re-derived,
  // so the note and the email cannot state different prices.
  const protocol = await planProtocolFor(draft.newMedications)

  // Asked before anything is written, because the answer can only be acted on
  // while the review is still open.
  const preflight = [
    ...(await labOrderProblems(review.patientId, draft.labOrders)),
    ...(await consultProblems(review.patientId, draft.consultation)),
    ...(await protocolProblems(review.patientId, protocol)),
  ]
  if (preflight.length) {
    return { ok: false, error: `${preflight.join(' ')} Nothing has been saved.` }
  }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const plan = planCompletion(draft, actor.displayName, protocolOutcome(protocol))
  const now = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('lab_reviews')
    .update({
      status: 'finished',
      disposition: draft.disposition,
      disposition_detail: plan.detail,
      resolution: plan.resolution,
      reviewed_at: now,
      reviewed_by: access.userId,
      // The final draft is kept rather than cleared: it is what the disposition
      // was derived from, and a finished review that cannot show its own working
      // is not auditable.
      draft,
      draft_updated_at: now,
      needs_attention_reason: null,
      // A review nobody claimed can still be finished; record who did it.
      assigned_to: review.assignedTo ?? access.userId,
      updated_at: now,
    })
    .eq('id', reviewId)
    .neq('status', 'finished')
    .select('id')
  if (error) return { ok: false, error: `Could not finish this review: ${error.message}` }
  if (!updated?.length) {
    return { ok: false, error: 'This review was finished by somebody else. Reload the page.' }
  }

  const warnings = await applySideEffects(access, review.patientId, plan)
  warnings.push(...(await placeLabOrders(access, reviewId, draft.labOrders)))
  warnings.push(...(await sendConsultInvite(access, reviewId, draft.consultation)))

  const protocolSend = await sendRecommendedProtocol(
    access,
    reviewId,
    review.patientId,
    protocol,
    draft.newMedications
  )
  warnings.push(...protocolSend.warnings)

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'completed',
    actor,
    summary: `${actor.displayName} finished the review — ${plan.resolution}`,
    fromStatus: review.status,
    toStatus: 'finished',
    metadata: {
      disposition: draft.disposition,
      addedFlagIds: plan.addFlagIds,
      removedFlagIds: plan.removeFlagIds,
      patientStatusId: plan.patientStatusId,
      labOrdersPlaced: draft.labOrders.length,
      consultationRequested: draft.consultation?.eventTypeId ?? null,
      protocol: protocolSend.recorded,
      sideEffectWarnings: warnings,
    },
  })
  if (!logged.ok) {
    warnings.push(`the audit log entry failed (${logged.error})`)
  }

  if (warnings.length) {
    return {
      ok: true,
      warning: `Review finished, but ${warnings.join('; ')}. Tell an administrator.`,
    }
  }
  return { ok: true }
}

/**
 * Mark the review finished after Approve has already sent the protocol, the
 * patient message, the customer service action, and the chart note.
 *
 * Those writes must not run again here — a second protocol email, chart note,
 * lab order, or consultation invitation is the failure this exists to prevent.
 * What remains is the review row and a patient-status change the earlier
 * slices do not own.
 */
export async function closeLabReview(
  access: ProviderAccess,
  reviewId: string,
  draft: ReviewDraft
): Promise<MutationResult> {
  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is already finished.' }
  }
  if (review.assignedTo && review.assignedTo !== access.userId) {
    const holder = await nameOf(review.assignedTo)
    return { ok: false, error: `${holder} holds this review. It cannot be finished from here.` }
  }

  const header = await getPatientHeader(review.patientId)
  const problems = validateCompletion(draft, workflowFor(header?.status ?? null))
  if (problems.length) return { ok: false, error: problems.join(' ') }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const plan = planCompletion(draft, actor.displayName, protocolOutcome(await planProtocolFor(draft.newMedications)))
  const now = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('lab_reviews')
    .update({
      status: 'finished',
      disposition: draft.disposition,
      disposition_detail: plan.detail,
      resolution: plan.resolution,
      reviewed_at: now,
      reviewed_by: access.userId,
      draft,
      draft_updated_at: now,
      needs_attention_reason: null,
      assigned_to: review.assignedTo ?? access.userId,
      updated_at: now,
    })
    .eq('id', reviewId)
    .neq('status', 'finished')
    .select('id')
  if (error) return { ok: false, error: `Could not finish this review: ${error.message}` }
  if (!updated?.length) {
    return { ok: false, error: 'This review was finished by somebody else. Reload the page.' }
  }

  const warnings = await applyClosingEffects(access, review.patientId, plan)

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'completed',
    actor,
    summary: `${actor.displayName} finished the review — ${plan.resolution}`,
    fromStatus: review.status,
    toStatus: 'finished',
    metadata: {
      disposition: draft.disposition,
      labOrdersPlaced: draft.labOrders.length,
      consultationRequested: draft.consultation?.eventTypeId ?? null,
      sideEffectWarnings: warnings,
    },
  })
  if (!logged.ok) {
    warnings.push(`the audit log entry failed (${logged.error})`)
  }

  if (warnings.length) {
    return {
      ok: true,
      warning: `Review finished, but ${warnings.join('; ')}. Tell an administrator.`,
    }
  }
  return { ok: true }
}

/** Status only. Flags and the chart note were written when Approve sent them. */
async function applyClosingEffects(
  access: ProviderAccess,
  patientId: string,
  plan: CompletionPlan
): Promise<string[]> {
  if (plan.patientStatusId === null) return []

  const admin = createAdminClient()
  const { error } = await admin
    .from('user_list')
    .update({ status: plan.patientStatusId })
    .eq('user_id', patientId)
  return error ? ["the patient's status could not be updated"] : []
}

/**
 * Place the orders the review was carrying, one at a time.
 *
 * `scheduleLabOrder` is reused rather than inlined, so an order placed from a
 * completed review is written exactly like one placed on its own: the same row in
 * `scheduled_lab_requisitions` for the main app's cron, the same detailed chart
 * note listing every test, the same onboarding status bump, and its own
 * `labs_ordered` entry in the review's history.
 *
 * Failures come back as warnings because the review is already finished by now.
 * That is only tolerable because `labOrderProblems` has already ruled out the
 * predictable refusals; what is left is the database being unreachable, which no
 * amount of ordering could have prevented.
 */
async function placeLabOrders(
  access: ProviderAccess,
  reviewId: string,
  orders: LabOrder[]
): Promise<string[]> {
  const warnings: string[] = []

  for (const order of orders) {
    // Named by its date, which is the only thing that tells two orders on one
    // review apart in a warning the provider reads once.
    const where = `the lab order for ${order.timing === 'now' ? 'now' : orderWhen(order)}`
    try {
      const result = await scheduleLabOrder(access, reviewId, order)
      if (!result.ok) warnings.push(`${where} was not placed (${result.error})`)
      else if (result.warning) warnings.push(`${where} was placed but not fully recorded`)
    } catch (error) {
      warnings.push(
        `${where} was not placed (${error instanceof Error ? error.message : 'unknown error'})`
      )
    }
  }

  return warnings
}

/**
 * Send the booking link the review was carrying.
 *
 * `requestConsultation` is reused unchanged, so an invitation sent from a completed
 * review is indistinguishable from one sent on its own: the same single-use
 * Calendly link, the same Paubox email, the same chart note and the same
 * `consultation_requested` entry in the review's history.
 *
 * A failure is a warning for the same reason a lab order's is — the review is
 * already finished, and a Calendly outage must not un-finish it. What is left after
 * `consultProblems` is a third party being unreachable, which is worth telling the
 * provider about precisely because the fix is to invite the patient by hand.
 */
async function sendConsultInvite(
  access: ProviderAccess,
  reviewId: string,
  request: ConsultRequest | null
): Promise<string[]> {
  if (!request) return []

  try {
    const result = await requestConsultation(access, reviewId, request)
    if (!result.ok) return [`the consultation invitation was not sent (${result.error})`]
    if (result.warning) return ['the consultation invitation was sent but not fully recorded']
    return []
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return [`the consultation invitation was not sent (${message})`]
  }
}

/**
 * Send the recommended protocol the added medications came to.
 *
 * The one side effect at completion that quotes the patient a price, so it runs
 * last: everything before it is a record of a decision, and this is the first
 * thing that asks for money. A failure anywhere earlier therefore happens before
 * a price has been promised.
 *
 * `sendProtocol` is where the ordering and the compensating delete live. This only
 * translates its outcome into the two things the caller needs — warnings for the
 * provider, and a line for the review's history — and it treats a handoff as a
 * *normal* result rather than a warning. A protocol staff will price by hand is
 * how most of them are priced today; telling the provider "something went wrong"
 * about the status quo would train them to ignore the message.
 */
async function sendRecommendedProtocol(
  access: ProviderAccess,
  reviewId: string,
  patientId: string,
  plan: ProtocolPlan,
  medications: ReviewDraft['newMedications']
): Promise<{ warnings: string[]; recorded: unknown }> {
  let result: ProtocolSendResult
  try {
    result = await sendProtocol(access, reviewId, patientId, plan, medications)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return {
      warnings: [`the recommended protocol was not sent (${message})`],
      recorded: { status: 'error', error: message },
    }
  }

  switch (result.kind) {
    case 'nothing-to-send':
      return { warnings: [], recorded: null }

    case 'handed-off':
      return {
        warnings: [],
        recorded: { status: 'handed-off', reasons: handoffLines(result.blocks) },
      }

    case 'failed':
      return {
        warnings: [`the recommended protocol was not sent (${result.error})`],
        recorded: { status: 'failed', error: result.error },
      }

    case 'sent':
      return {
        warnings: result.warnings,
        recorded: { status: 'sent', snapshotId: result.snapshotId },
      }
  }
}

/**
 * The flag, status and chart-note writes that follow a completed review.
 *
 * Each is attempted independently and each failure is *reported*, never thrown.
 * The review is already finished by the time this runs, so aborting would leave
 * the caller thinking nothing happened while the queue says otherwise. What the
 * provider needs instead is the specific thing that did not apply, because the
 * fix is manual.
 */
async function applySideEffects(
  access: ProviderAccess,
  patientId: string,
  plan: CompletionPlan
): Promise<string[]> {
  const admin = createAdminClient()
  const warnings: string[] = []

  if (plan.removeFlagIds.length) {
    // Deleted, not deactivated — mirroring the main app, where this flag carries
    // no history and `lab_reviews` is the record.
    const { error } = await admin
      .from('user_flags_join')
      .delete()
      .eq('patient_id', patientId)
      .in('flag_id', plan.removeFlagIds)
    if (error) warnings.push('the "Needs lab review" flag could not be cleared')
  }

  for (const flagId of plan.addFlagIds) {
    const added = await addPatientFlag(patientId, flagId, access.userId)
    if (!added) warnings.push(`flag ${flagId} could not be added`)
  }

  if (plan.patientStatusId !== null) {
    const { error } = await admin
      .from('user_list')
      .update({ status: plan.patientStatusId })
      .eq('user_id', patientId)
    if (error) warnings.push("the patient's status could not be updated")
  }

  const { error: noteError } = await admin.from('patient_notes_private').insert({
    patient_id: patientId,
    created_by: access.userId,
    // Plain text, matching every other server-side note writer. HTML is never
    // built from provider free text.
    note: plan.note,
  })
  if (noteError) warnings.push('the completion note could not be written to the chart')

  return warnings
}

/**
 * Park a review as needing attention, for the assigned provider, customer
 * service, another provider, or a combination.
 *
 * Ordering, and why: the review row moves to `needs_attention` first, then the
 * routing side effects run. Same reasoning as completion — no transaction spans
 * these tables, so the review row is the one place that records the whole
 * intent, and a failed side effect is reported rather than pretending the
 * park did not happen.
 *
 * **No targets is a self-park.** The review stays assigned (or is claimed if it
 * was unassigned). No CS task, no patient flag.
 *
 * **Customer service does not take the review.** `assigned_to` is left alone on
 * the CS route, per the doc: CS cannot make the clinical decision that closes a
 * review, so handing them the row would strand it.
 */
export async function escalateLabReview(
  access: ProviderAccess,
  reviewId: string,
  escalation: Escalation
): Promise<MutationResult> {
  const problems = validateEscalation(escalation)
  if (problems.length) return { ok: false, error: problems.join(' ') }

  const review = await loadForMutation(reviewId)
  if (!review) return { ok: false, error: 'This review no longer exists.' }

  if (review.status === 'finished') {
    return { ok: false, error: 'This review is already finished.' }
  }

  const handingTo = transfersOwnership(escalation) ? escalation.toProviderId : null
  if (handingTo && !(await holdsProviderRole(handingTo))) {
    return { ok: false, error: 'A lab review can only be assigned to a provider.' }
  }

  const admin = createAdminClient()
  const actor = await resolveActor(access)
  const note = escalation.note.trim()
  const now = new Date().toISOString()

  const { data: updated, error } = await admin
    .from('lab_reviews')
    .update({
      status: 'needs_attention',
      needs_attention_reason: note,
      needs_attention_at: now,
      needs_attention_by: access.userId,
      needs_attention_targets: escalation.targets,
      // Unassigned reviews get claimed by whoever parked them, so a parked
      // review always names somebody clinical. Self-park and the CS route
      // deliberately do not move an existing assignment.
      assigned_to: handingTo ?? review.assignedTo ?? access.userId,
      updated_at: now,
    })
    .eq('id', reviewId)
    .neq('status', 'finished')
    .select('id')
  if (error) return { ok: false, error: `Could not park this review: ${error.message}` }
  if (!updated?.length) {
    return { ok: false, error: 'This review was finished by somebody else. Reload the page.' }
  }

  const warnings: string[] = []

  // The review-scoped note: the doc's second note type. Unlike a completion note
  // this stays off the chart, because it is about handling the review rather than
  // about the patient's care.
  const { error: noteError } = await admin.from('lab_review_notes').insert({
    lab_review_id: reviewId,
    created_by: access.userId,
    note,
    kind: 'handoff',
  })
  if (noteError) warnings.push('the handoff note could not be saved')

  if (escalation.targets.includes('customer_service')) {
    warnings.push(...(await routeToCustomerService(access, review, note, actor.displayName)))
  }

  const handedToName = handingTo ? await nameOf(handingTo) : null

  const logged = await logLabReviewEvent({
    labReviewId: reviewId,
    eventType: 'needs_attention_requested',
    actor,
    summary: summarizeNeedsAttention({
      actorName: actor.displayName,
      targets: escalation.targets,
      handedToName,
    }),
    fromStatus: review.status,
    toStatus: 'needs_attention',
    metadata: { targets: escalation.targets, handedTo: handingTo, note },
  })
  if (!logged.ok) warnings.push(`the audit log entry failed (${logged.error})`)

  if (warnings.length) {
    return {
      ok: true,
      warning: `Parked, but ${warnings.join('; ')}. Tell an administrator.`,
    }
  }
  return { ok: true }
}

/**
 * Create the customer service task and point the review at it.
 *
 * `cs_action_id` already had a foreign key to `actions` before this portal wrote
 * anything, so the plumbing is pre-existing — this fills it in. Status and
 * priority are resolved **by name** rather than by hardcoded uuid, matching the
 * main app, so a differently seeded environment still works.
 */
async function routeToCustomerService(
  access: ProviderAccess,
  review: ReviewGuardRow,
  note: string,
  providerName: string
): Promise<string[]> {
  const admin = createAdminClient()
  const warnings: string[] = []

  const [statusRow, priorityRow, csRole] = await Promise.all([
    admin.from('actions_statuses').select('id').eq('name', 'New').maybeSingle(),
    admin.from('actions_priorities').select('id').eq('name', 'Normal').maybeSingle(),
    admin.from('user_roles').select('id').eq('role', 'customer_service').maybeSingle(),
  ])

  const statusId = statusRow.data?.id
  const priorityId = priorityRow.data?.id
  const groupId = csRole.data?.id

  if (!statusId || !priorityId || !groupId) {
    return ['the customer service task could not be created (status, priority or group missing)']
  }

  const { data: action, error: actionError } = await admin
    .from('actions')
    .insert({
      title: 'Lab review needs customer service',
      description: `${providerName} escalated a lab review.\n\n${note}`,
      patient_user_id: review.patientId,
      created_by_user_id: access.userId,
      assignee_group_id: Number(groupId),
      status_id: statusId,
      priority_id: priorityId,
    })
    .select('id')
    .maybeSingle()

  if (actionError || !action) {
    return [`the customer service task could not be created (${actionError?.message ?? 'unknown'})`]
  }

  const { error: linkError } = await admin
    .from('lab_reviews')
    .update({ cs_action_id: action.id, updated_at: new Date().toISOString() })
    .eq('id', review.id)
  if (linkError) {
    warnings.push('the customer service task was created but is not linked to this review')
  }

  // "Follow Up Required" is what makes the escalation visible outside this review,
  // on the patient's own record.
  const flagged = await addPatientFlag(review.patientId, FLAG.followUpRequired, access.userId)
  if (!flagged) warnings.push('the "Follow Up Required" flag could not be added')

  return warnings
}

/** Read from `user_roles_join`, never `user_list.role` — same reason as
 *  `checkProviderAccess`. Admins are accepted too: an admin covering the queue
 *  is a real case, and they already pass the read gate. */
async function holdsProviderRole(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_roles_join')
    .select('role')
    .eq('user_id', userId)
  if (error) throw new Error(`role lookup failed: ${error.message}`)

  const roles = (data ?? []).map((r) => Number(r.role))
  return roles.includes(ROLE.provider) || roles.includes(ROLE.admin)
}

export type { Actor }
