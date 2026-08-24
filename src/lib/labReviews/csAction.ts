/**
 * Whether finishing will create a customer service action, decided as a pure
 * function.
 *
 * The confirmation screen shows the provider the customer-service text; this
 * decides whether that text becomes an `actions` row assigned to the customer
 * service group. Empty is a skip, not a dummy task.
 */

export type CsActionPlan =
  | { kind: 'skip' }
  | { kind: 'create'; title: string; description: string }

export function planCsAction(input: {
  customerService: string
  dispositionLabel: string
}): CsActionPlan {
  const description = input.customerService.trim()
  if (!description) return { kind: 'skip' }

  return {
    kind: 'create',
    title: `Lab review — ${input.dispositionLabel}`,
    description,
  }
}
