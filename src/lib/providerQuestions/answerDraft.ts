// Explicit `.ts` specifiers: exercised by `npm test` through Node's type stripping.
import { parseConsultRequest, type ConsultRequest } from '../consultations/request.ts'
import { parseOrders, type LabOrder } from '../labOrders/order.ts'
import type { DoseChange } from '../labReviews/reviewDraft.ts'

/**
 * The shape of an in-progress answer to a Provider Question.
 *
 * A cut-down `ReviewDraft`: no disposition (finishing a Provider Question is
 * answering it, and nobody should have to pick "continue protocol" to reply),
 * no new medications or discounts (a protocol is a Lab Review decision), and a
 * `followUp` switch in place of the follow-up disposition. Everything else is
 * the Lab Review toolkit, in the same shapes so the same panels edit it.
 *
 * Lives in `provider_questions.draft` as jsonb, autosaved as the provider
 * types, so `parseAnswerDraft` reads defensively and never throws.
 */
export type AnswerDraft = {
  /** The answer. Required to finish. */
  patientMessage: string
  doseChanges: DoseChange[]
  labOrders: LabOrder[]
  consultation: ConsultRequest | null
  /** Raise the Follow Up Required flag on finish. */
  followUp: boolean
  /** Request from CS. Non-empty creates an Open Action. */
  csInstructions: string
  /** AI summary of what the provider did, written when Finish opens. */
  chartSummary: string
}

export const EMPTY_ANSWER_DRAFT: AnswerDraft = {
  patientMessage: '',
  doseChanges: [],
  labOrders: [],
  consultation: null,
  followUp: false,
  csInstructions: '',
  chartSummary: '',
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function rowId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function doseChangesFrom(value: unknown): DoseChange[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((change) => ({
      medicationId: rowId(change.medicationId),
      medication: str(change.medication),
      from: str(change.from),
      value: str(change.value),
      sig: str(change.sig),
    }))
}

/** Tolerant read of the `draft` column. Unknown keys — a `disposition` from a
 *  Lab Review draft pasted in by mistake — are dropped. */
export function parseAnswerDraft(json: unknown): AnswerDraft {
  if (!json || typeof json !== 'object') return EMPTY_ANSWER_DRAFT
  const raw = json as Record<string, unknown>

  return {
    patientMessage: str(raw.patientMessage),
    doseChanges: doseChangesFrom(raw.doseChanges),
    labOrders: parseOrders(raw.labOrders),
    consultation: parseConsultRequest(raw.consultation),
    followUp: raw.followUp === true,
    csInstructions: str(raw.csInstructions),
    chartSummary: str(raw.chartSummary),
  }
}

export function isAnswerDraftEmpty(draft: AnswerDraft): boolean {
  return (
    !draft.patientMessage.trim() &&
    draft.doseChanges.every((c) => !c.medication.trim() && !c.value.trim()) &&
    draft.labOrders.length === 0 &&
    draft.consultation === null &&
    !draft.followUp &&
    !draft.csInstructions.trim()
  )
}
