/**
 * Parking a review as needing attention, and who it is being parked *for*.
 *
 * Pure, so the needs-attention panel and the server action validate
 * identically and the rules are testable without a database.
 *
 * A park needs a note. Targets are optional: none means the assigned provider
 * is coming back to it, and nobody else is involved. Customer service never
 * owns a lab review — escalating to CS creates a task for them and flags the
 * patient, but the review stays assigned, because CS cannot make the clinical
 * decision that closes it. Only the provider route changes who holds it.
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
  /** Why. Required — a park with no explanation is a dead end when they come
   *  back, or for whoever is involved. */
  note: string
  /** Only meaningful when `provider` is targeted. */
  toProviderId: string | null
}

/** Shown under the target checkboxes so leaving both unchecked is a real choice,
 *  not a half-filled form. */
export const SELF_PARK_HINT =
  'Leave both unchecked to keep the review and park it for yourself.'

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

  if (!escalation.note.trim()) {
    problems.push('Say why this needs attention.')
  }
  if (escalation.targets.includes('provider') && !escalation.toProviderId) {
    problems.push('Choose which provider to hand this to.')
  }

  return problems
}

/** True when the escalation changes who holds the review. Escalating to customer
 *  service alone does not, and neither does parking it for yourself. */
export function transfersOwnership(escalation: Escalation): boolean {
  return escalation.targets.includes('provider')
}

/** Audit-trail sentence. A self-park is not an escalation — nobody else was
 *  asked to do anything. */
export function summarizeNeedsAttention({
  actorName,
  targets,
  handedToName,
}: {
  actorName: string
  targets: EscalationTarget[]
  handedToName: string | null
}): string {
  if (targets.length === 0) {
    return `${actorName} marked this as needing attention`
  }

  const targetNames = targets.map((t) => ESCALATION_TARGET_LABELS[t]).join(' and ')
  return handedToName
    ? `${actorName} escalated to ${targetNames}, handing the review to ${handedToName}`
    : `${actorName} escalated to ${targetNames}`
}
