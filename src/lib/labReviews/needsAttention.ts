/**
 * Parking a review as needing attention, and who it is being parked *for*.
 *
 * Pure, so the escalation panel and the server action validate identically and
 * the rules are testable without a database.
 *
 * The load-bearing rule, from the planning doc: **customer service never owns a
 * lab review.** Escalating to CS creates a task for them and flags the patient,
 * but the review stays assigned to the provider who escalated it, because CS
 * cannot make the clinical decision that closes it. Only the provider route
 * changes who holds the review.
 */

export const ESCALATION_TARGETS = ['customer_service', 'provider'] as const

export type EscalationTarget = (typeof ESCALATION_TARGETS)[number]

export function isEscalationTarget(value: unknown): value is EscalationTarget {
  return typeof value === 'string' && (ESCALATION_TARGETS as readonly string[]).includes(value)
}

export const ESCALATION_TARGET_LABELS: Record<EscalationTarget, string> = {
  customer_service: 'Customer service',
  provider: 'Another provider',
}

export const ESCALATION_TARGET_HINTS: Record<EscalationTarget, string> = {
  customer_service: 'Creates a task for CS and flags the patient. The review stays yours.',
  provider: 'Hands the review over. They become responsible for finishing it.',
}

export type Escalation = {
  targets: EscalationTarget[]
  /** Why. Required — an escalation with no explanation is a dead end for whoever
   *  picks it up. */
  note: string
  /** Only meaningful when `provider` is targeted. */
  toProviderId: string | null
}

export const EMPTY_ESCALATION: Escalation = {
  targets: [],
  note: '',
  toProviderId: null,
}

/** Tolerant read of a target list arriving from the browser. */
export function parseTargets(value: unknown): EscalationTarget[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isEscalationTarget))]
}

export function validateEscalation(escalation: Escalation): string[] {
  const problems: string[] = []

  if (escalation.targets.length === 0) {
    problems.push('Choose who this needs to go to.')
  }
  if (!escalation.note.trim()) {
    problems.push('Say why this needs attention.')
  }
  if (escalation.targets.includes('provider') && !escalation.toProviderId) {
    problems.push('Choose which provider to hand this to.')
  }

  return problems
}

/** True when the escalation changes who holds the review. Escalating to customer
 *  service alone does not. */
export function transfersOwnership(escalation: Escalation): boolean {
  return escalation.targets.includes('provider')
}
