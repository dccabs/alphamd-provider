import {
  DIAGNOSIS_CODES,
  LAB_PRESETS,
  LAB_TESTS,
  PHLEBOTOMY_CODE,
  TEST_NAMES,
  isRestrictedState,
  type LabPreset,
} from './catalog.ts'

/**
 * A lab order being composed, and the payload it becomes.
 *
 * Pure, so the panel and the server action validate identically and every rule
 * here is testable without a database.
 *
 * ## Everything is written as a *scheduled* requisition
 *
 * The main app has two paths: an immediate order inserts `lab_requisitions` and
 * the UI then calls a second endpoint that emails the patient, while a future
 * order inserts `scheduled_lab_requisitions` for the `process-scheduled-labs`
 * cron to pick up. This portal only writes the second table — an order placed
 * "now" is a scheduled order dated now.
 *
 * That is a deliberate trade. Writing `lab_requisitions` from here would mean
 * porting Paubox email, PDF generation and Telnyx SMS into a second app, or
 * inserting a row that nobody ever emails — a provider believing labs were
 * ordered while the patient never hears about it. Going through the cron reuses
 * the delivery path that already works, at the cost of up to five minutes before
 * the patient's email goes out. Nobody needs a lab order in under five minutes.
 */

export type OrderTiming =
  | 'now'
  | 'in_6_weeks'
  | 'in_8_weeks'
  | 'in_10_weeks'
  | 'in_12_weeks'
  | 'in_6_months'
  | 'custom'

export const ORDER_TIMINGS: OrderTiming[] = [
  'now',
  'in_6_weeks',
  'in_8_weeks',
  'in_10_weeks',
  'in_12_weeks',
  'in_6_months',
  'custom',
]

export const ORDER_TIMING_LABELS: Record<OrderTiming, string> = {
  now: 'Now',
  in_6_weeks: '6 weeks',
  in_8_weeks: '8 weeks',
  in_10_weeks: '10 weeks',
  in_12_weeks: '12 weeks',
  in_6_months: '6 months',
  custom: 'Pick a date',
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Add months, clamping to the end of the target month.
 *
 * `setMonth` alone rolls over: 31 August plus six months becomes "31 February",
 * which JavaScript resolves to 3 March. The main app gets clamping for free from
 * moment, and a "6 months" order that quietly lands in March instead of February
 * is a week of drift in a monitoring interval. Time of day is untouched.
 */
function addMonths(from: Date, months: number): Date {
  const day = from.getDate()
  const date = new Date(from.getTime())

  date.setDate(1)
  date.setMonth(date.getMonth() + months)

  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDayOfMonth))

  return date
}

/**
 * When the order should be sent to the patient.
 *
 * `now` is deliberately *now* and not midnight: the cron compares
 * `scheduled_date <= now()`, so a date floored to the start of today would also
 * work, while a date rounded up to tomorrow would silently delay the order by a
 * day.
 */
export function scheduledDateFor(
  timing: OrderTiming,
  customDate: string,
  from: Date = new Date()
): Date | null {
  switch (timing) {
    case 'now':
      return from
    case 'in_6_weeks':
      return new Date(from.getTime() + 6 * WEEK_MS)
    case 'in_8_weeks':
      return new Date(from.getTime() + 8 * WEEK_MS)
    case 'in_10_weeks':
      return new Date(from.getTime() + 10 * WEEK_MS)
    case 'in_12_weeks':
      return new Date(from.getTime() + 12 * WEEK_MS)
    case 'in_6_months':
      return addMonths(from, 6)
    case 'custom':
      return parseCustomDate(customDate)
  }
}

/**
 * A `<input type="date">` value, read as **noon local time**.
 *
 * Midnight would be the obvious choice and is wrong: `new Date('2026-09-01')`
 * parses as UTC midnight, which is the previous evening anywhere west of
 * Greenwich, so an order for the 1st would be dated the 31st. Noon is far enough
 * from both boundaries that no timezone shifts the day.
 */
function parseCustomDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export type LabOrder = {
  timing: OrderTiming
  /** `yyyy-mm-dd`, only meaningful when `timing` is `custom`. */
  customDate: string
  providerId: string
  /** Selected test codes. */
  testCodes: string[]
  /** Of the selected tests, those the patient may not remove. */
  requiredCodes: string[]
  /** Of the selected tests, those AlphaMD is covering. */
  compedCodes: string[]
  diagnosisCodes: string[]
}

export const EMPTY_ORDER: LabOrder = {
  timing: 'now',
  customDate: '',
  providerId: '',
  testCodes: [],
  requiredCodes: [],
  compedCodes: [],
  diagnosisCodes: [],
}

export function applyPreset(order: LabOrder, preset: LabPreset): LabOrder {
  return {
    ...order,
    testCodes: [...preset.testCodes],
    requiredCodes: [...(preset.requiredCodes ?? [])],
    // A preset never comps anything. Whether AlphaMD covers a test is a business
    // decision per patient, not a property of the panel.
    compedCodes: [],
    diagnosisCodes: [...preset.diagnosisCodes],
  }
}

export function validateOrder(
  order: LabOrder,
  patientState: string | null | undefined
): string[] {
  const problems: string[] = []

  if (!order.providerId) problems.push('Choose the ordering provider.')
  if (order.testCodes.length === 0) problems.push('Select at least one lab test.')
  if (order.diagnosisCodes.length === 0) problems.push('Select at least one diagnosis code.')

  if (order.timing === 'custom') {
    const date = parseCustomDate(order.customDate)
    if (!date) problems.push('Enter the date these labs should be sent.')
    else if (date.getTime() < Date.now() - WEEK_MS) {
      // The cron expires anything more than a week overdue, so a date further
      // back than that would be created and immediately abandoned.
      problems.push('That date is in the past.')
    }
  }

  if (order.testCodes.includes(PHLEBOTOMY_CODE) && order.testCodes.length > 1) {
    problems.push('Therapeutic phlebotomy must be ordered on its own requisition.')
  }

  if (order.compedCodes.length > 0 && isRestrictedState(patientState)) {
    problems.push('Discounted labs are not available in New York or New Jersey.')
  }

  const known = new Set(LAB_TESTS.map((t) => t.code))
  if (order.testCodes.some((code) => !known.has(code))) {
    problems.push('One of the selected tests is not orderable.')
  }

  const knownDx = new Set(DIAGNOSIS_CODES.map((d) => d.code))
  if (order.diagnosisCodes.some((code) => !knownDx.has(code))) {
    problems.push('One of the selected diagnosis codes is not recognised.')
  }

  return problems
}

/**
 * One entry in the `requests` / `diagnosis_code` JSON.
 *
 * `is_requested` exists because the main app stores the **whole catalogue** on
 * every requisition with a flag per row, rather than only what was ordered. Its
 * cron, its emails and its patient order page all filter on `is_requested`, so
 * that shape is an interface. Writing only the selected tests would read as an
 * order for nothing.
 */
export type RequisitionEntry = {
  code: string
  name: string
  is_requested: boolean
  is_required?: boolean
  is_comped?: boolean
}

export function requestsPayload(order: LabOrder): RequisitionEntry[] {
  const selected = new Set(order.testCodes)
  const required = new Set(order.requiredCodes)
  const comped = new Set(order.compedCodes)

  return LAB_TESTS.map((test) => ({
    code: test.code,
    name: test.name,
    is_requested: selected.has(test.code),
    is_required: selected.has(test.code) && required.has(test.code),
    is_comped: selected.has(test.code) && comped.has(test.code),
  }))
}

export function diagnosisPayload(order: LabOrder): RequisitionEntry[] {
  const selected = new Set(order.diagnosisCodes)

  return DIAGNOSIS_CODES.map((dx) => ({
    code: dx.code,
    name: dx.name,
    is_requested: selected.has(dx.code),
  }))
}

export function testLabel(code: string): string {
  return TEST_NAMES[code] ?? code
}

export function presetById(id: string): LabPreset | undefined {
  return LAB_PRESETS.find((p) => p.id === id)
}

/**
 * The chart note recorded alongside the order, matching the main app's wording so
 * the two apps' notes read alike on the same chart.
 */
export function orderNote(order: LabOrder, scheduledDate: Date, immediate: boolean): string {
  const when = scheduledDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const parts: string[] = [
    immediate
      ? 'Lab order placed; the patient will be emailed shortly.'
      : `Future lab order scheduled for ${when}.`,
  ]

  parts.push(`Labs Ordered:\n${order.testCodes.map((c) => `- ${testLabel(c)}`).join('\n')}`)

  if (order.diagnosisCodes.length) {
    parts.push(
      `Diagnosis Codes:\n${order.diagnosisCodes.map((c) => `- ${testLabel(c)}`).join('\n')}`
    )
  }

  if (order.compedCodes.length) {
    parts.push(`Covered by AlphaMD:\n${order.compedCodes.map((c) => `- ${testLabel(c)}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

/** One line for the review's audit trail. */
export function orderSummary(order: LabOrder, scheduledDate: Date, immediate: boolean): string {
  const names = order.testCodes.map(testLabel).join(', ')
  if (immediate) return `Ordered labs now: ${names}`

  const when = scheduledDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `Scheduled labs for ${when}: ${names}`
}
