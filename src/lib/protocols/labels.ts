import { formatUsd, type Cents } from './money.ts'

/**
 * The strings that go into a pricing snapshot's discount breakdowns.
 *
 * These are not presentation. `monthly_discount_breakdown` and
 * `overall_discount_breakdown` are stored on the row as `{ name, amount }` pairs,
 * and alphamd's `/pricing/[id]` and `/profile/recommended-protocol` pages render
 * the stored `name` verbatim — so a label is part of the financial record a
 * patient agreed to, and it has to come out of here identical to what the admin
 * app produces.
 *
 * Two details are easy to get wrong and expensive to notice:
 *
 *   - The first-month suffix uses an **en dash** (–), not a hyphen. It is lifted
 *     from the legacy template literals rather than retyped.
 *   - Dollar amounts carry no thousands separator, because the legacy code builds
 *     them with `toFixed(2)`. See `formatUsd`.
 *
 * A percentage is written as the configured number, so 20 reads "20%" and 12.5
 * reads "12.5%" — which falls out of template interpolation and is why the value
 * is not pre-formatted.
 */

/** The fallbacks the admin app uses when a custom entry was left unnamed. */
const UNNAMED_DISCOUNT = 'Custom Discount'
const UNNAMED_COUPON = 'Coupon Discount'
const UNNAMED_ADDON = 'Custom Add-on'

/** A name, or the fallback for a custom entry someone left blank. */
function named(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : fallback
}

/** `Military/First Responder (20%)` */
export function monthlyPercentageLabel(name: string | null | undefined, percent: number): string {
  return `${named(name, UNNAMED_DISCOUNT)} (${percent}%)`
}

/** `Friends/Family (-$30.00/mo)` — the only label that carries a rate. */
export function monthlyFixedLabel(name: string | null | undefined, amount: Cents): string {
  return `${named(name, UNNAMED_DISCOUNT)} (-${formatUsd(amount)}/mo)`
}

/**
 * `Coupon: 4THOFJULY26 (50% – first month only)`
 *
 * En dash, not a hyphen.
 */
export function firstMonthPercentageLabel(
  name: string | null | undefined,
  percent: number
): string {
  return `${named(name, UNNAMED_COUPON)} (${percent}% – first month only)`
}

/**
 * `Coupon: SWITCH2026 (-$50.00 – first month only)`
 *
 * En dash again, and a space either side of it.
 */
export function firstMonthFixedLabel(name: string | null | undefined, amount: Cents): string {
  return `${named(name, UNNAMED_COUPON)} (-${formatUsd(amount)} – first month only)`
}

/** `Spring promo (10%)`, on the billing period total rather than a month. */
export function overallPercentageLabel(name: string | null | undefined, percent: number): string {
  return `${named(name, UNNAMED_DISCOUNT)} (${percent}%)`
}

/** `overall (-$25.00)` — no `/mo`, because it is taken once. */
export function overallFixedLabel(name: string | null | undefined, amount: Cents): string {
  return `${named(name, UNNAMED_DISCOUNT)} (-${formatUsd(amount)})`
}

/**
 * `Coupon applied (WELCOME50): first month reduced to $99.00`
 *
 * The one label that depends on the arithmetic rather than just the
 * configuration, because a target-price coupon sets the first month's price and
 * the label states what it landed on. The `Coupon: ` prefix is stripped from the
 * stored name so the code is not printed twice.
 */
export function targetPriceLabel(name: string | null | undefined, firstMonth: Cents): string {
  const code = name?.replace(/^Coupon:\s*/, '').trim()
  const prefix = code ? `Coupon applied (${code})` : named(name, 'Coupon applied')
  return `${prefix}: first month reduced to ${formatUsd(firstMonth)}`
}

/** A custom add-on's name, or the fallback for an unnamed one. */
export function addonLabel(name: string | null | undefined): string {
  return named(name, UNNAMED_ADDON)
}

/**
 * `Monthly`, `3 Months`, `6 Months`, `12 Months`.
 *
 * Stored in `duration_label` and shown beside the price. Anything else falls
 * through to `N Months`, which is how the admin app handles a prepay plan nobody
 * has configured a nicer name for.
 */
export function durationLabel(months: number): string {
  switch (months) {
    case 1:
      return 'Monthly'
    case 3:
      return '3 Months'
    case 6:
      return '6 Months'
    case 12:
      return '12 Months'
    default:
      return `${months} Months`
  }
}

/**
 * `100mg`, or whatever the provider wrote instead.
 *
 * Stored in `dosage`, and it is a sentence rather than a number more often than
 * you would guess. Testosterone cream is dosed in pump clicks, so real rows read
 * `2 clicks daily in the AM (~93mg/week)` while `dosage_mg` separately holds the
 * 93 that the pricing is calculated from. The two are not redundant: one is what
 * the patient does, the other is what the add-ons are charged against.
 *
 * `N/A` covers a protocol with no subscription dose at all, which is how
 * ancillary-only quotes are recorded.
 */
export function dosageLabel(dosageMg: number, custom?: string | null): string {
  const written = custom?.trim()
  if (written) return written

  return dosageMg > 0 ? `${dosageMg}mg` : 'N/A'
}

/**
 * The zone the clinic's billing dates have always been computed in.
 *
 * Not a guess. The legacy calculator ran in a staff member's browser and used
 * their local calendar date, so the stored dates record wherever that was:
 * replaying all 193 snapshots that have a `next_billing_date`, Pacific reproduces
 * 193 of them, Central and Eastern 192, and UTC only 186. The row that settles it
 * was written at 05:30 UTC — half past ten the previous evening in California —
 * and its billing date is a month from *that* previous day.
 *
 * Keeping it is also the more defensible choice going forward. This code now runs
 * on a server whose clock is UTC, for providers who could be in any zone, so
 * anchoring to one clinic zone makes the date a property of the clinic rather than
 * of whoever happened to click the button. It matches the default alphamd uses
 * server-side elsewhere, in `prescriptionDocument.ts`.
 */
const CLINIC_TIME_ZONE = 'America/Los_Angeles'

/** Today's calendar date where the clinic is, whatever the server's clock says. */
function clinicToday(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now)

  const value = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value)

  return { year: value('year'), month: value('month'), day: value('day') }
}

/**
 * `September 17, 2026` — when the next charge falls due.
 *
 * Stored in `next_billing_date`, which is a text column, so this string *is* the
 * value; nothing downstream parses it back into a date.
 *
 * Months are added the way the legacy code added them, with `setMonth`, which
 * overflows rather than clamping: a twelve-month plan sold on 31 August comes due
 * on 1 March, not 28 February. Preserved deliberately. No snapshot in the fixture
 * lands on such a day, so history does not settle it, and quietly changing it
 * would move a real billing date by a day or two.
 */
export function nextBillingDateLabel(now: Date, months: number): string {
  const { year, month, day } = clinicToday(now)

  const due = new Date(Date.UTC(year, month - 1, day))
  due.setUTCMonth(due.getUTCMonth() + months)

  return due.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
