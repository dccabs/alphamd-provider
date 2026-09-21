import type { ProviderQuestionStatus } from './queueRow.ts'

/**
 * Take-to-self, decided as a pure function.
 *
 * Any Working Provider may take a queued Provider Question, or one that another
 * provider has in progress (the "somebody is slow" case — there is no covering
 * roster in the product). A row stays on its Question Assignee until finish or
 * the next take; it never falls back to queued.
 */
export type TakePlan =
  | { kind: 'take'; from: string | null; toStatus: 'in_progress' }
  | { kind: 'already-mine' }
  | { kind: 'refuse'; error: string }

export function planTake(
  row: { status: ProviderQuestionStatus; assignedTo: string | null },
  viewerId: string
): TakePlan {
  if (row.status === 'finished') {
    return { kind: 'refuse', error: 'This Provider Question is already finished.' }
  }
  if (row.status === 'in_progress' && row.assignedTo === viewerId) {
    return { kind: 'already-mine' }
  }
  return { kind: 'take', from: row.assignedTo, toStatus: 'in_progress' }
}
