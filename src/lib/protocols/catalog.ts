import type { Discount, DiscountScope } from './discounts.ts'
import {
  firstMonthFixedLabel,
  firstMonthPercentageLabel,
  monthlyFixedLabel,
  monthlyPercentageLabel,
  overallFixedLabel,
  overallPercentageLabel,
} from './labels.ts'
import type { Addon } from './price.ts'
import { fromNumeric, type Cents } from './money.ts'

/**
 * The pricing catalog, and the questions worth asking of it.
 *
 * Six tables describe what the clinic sells: `subscription_products` with their
 * `subscription_prepayment_plans` and `subscription_addons`, the shared
 * `subscription_discounts`, and `ancillary_products` with their
 * `ancillary_pricing_tiers`. This module is the shape of that data in memory,
 * plus the lookups the engine needs — which plan for a term, which add-ons apply,
 * which discounts a product is eligible for.
 *
 * Pure, and separate from `loadCatalog.ts` for a practical reason as much as a
 * tidy one: the loader is `server-only`, and importing that package outside a
 * server bundle throws, so anything a unit test needs to reach has to live on
 * this side of the line.
 *
 * Prices are cents from the moment they are read. The database stores `numeric`
 * dollars, and the conversion happens once, in the loader.
 */

export type SubscriptionPlan = {
  id: number
  durationMonths: number
  monthlyPrice: Cents
  label: string | null
  sortOrder: number
  isActive: boolean
}

/**
 * A charge on top of a subscription's monthly price.
 *
 * The distinction matters at selection time rather than in the arithmetic: a
 * `per_unit` add-on is the dose surcharge and applies by itself, while a `flat`
 * one is an option somebody has to tick. See `addonsFor`.
 */
export type CatalogAddon = {
  id: number
  name: string
  addonType: 'per_unit' | 'flat'
  pricePerUnit: Cents
  threshold: number | null
  unitSize: number | null
  isActive: boolean
}

export type SubscriptionProduct = {
  id: number
  medicationId: number
  name: string
  baseMonthlyPrice: Cents
  isTaxable: boolean
  taxRate: number
  isActive: boolean
  plans: SubscriptionPlan[]
  addons: CatalogAddon[]
}

/**
 * Who a discount may be given to.
 *
 * Matched against the *product name*, which is as fragile as it sounds but is the
 * rule the admin app has always applied and the one every stored snapshot was
 * priced under. Renaming a subscription product silently changes who qualifies
 * for a discount, so the names are effectively part of the pricing configuration.
 */
export type DiscountAudience = 'all' | 'hormone_therapy' | 'trt_only'

export type CatalogDiscount = {
  id: number
  name: string
  code: string | null
  appliesTo: DiscountAudience
  scope: DiscountScope
  /** Lower numbers are taken off first. */
  priority: number
  isActive: boolean
  expiresAt: string | null
} & ({ kind: 'percentage'; percent: number } | { kind: 'fixed'; amount: Cents })

export type AncillaryTier = {
  id: number
  label: string
  price: Cents
  defaultQuantity: number | null
  sortOrder: number
  isActive: boolean
}

export type AncillaryPricingModel =
  | 'flat'
  | 'per_capsule'
  | 'tiered'
  | 'included'
  | 'external_referral'

export type AncillaryProduct = {
  id: number
  medicationId: number | null
  name: string
  pricingModel: AncillaryPricingModel
  basePrice: Cents
  processingFee: Cents
  isTaxable: boolean
  taxRate: number
  isActive: boolean
  sortOrder: number
  tiers: AncillaryTier[]
}

export type PricingCatalog = {
  subscriptions: SubscriptionProduct[]
  ancillaries: AncillaryProduct[]
  discounts: CatalogDiscount[]
}

/**
 * A product's terms, in the order staff arranged them.
 *
 * `sort_order` first, then duration. The fallback makes the list *stable*, not
 * sensible: the plans added after the column stopped being maintained all sit at
 * 0, so the cream's three prepay terms would otherwise come back in whatever
 * order the query returned. It does not tidy the result — the cream's monthly
 * plan is at 1 and its prepay plans at 0, so monthly sorts last, which is what
 * the admin app shows too. Overriding that here would only make the two apps
 * disagree about which plan a patient sees first.
 */
export function activePlans(product: SubscriptionProduct): SubscriptionPlan[] {
  return product.plans
    .filter((plan) => plan.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.durationMonths - b.durationMonths)
}

/**
 * The plan for a given term, or null if the product is not sold that way.
 *
 * Null is a real answer rather than an error: Enclomiphene has monthly, six and
 * twelve month terms but no three month one, and the GLP-1s are monthly only.
 */
export function planFor(
  product: SubscriptionProduct,
  durationMonths: number
): SubscriptionPlan | null {
  return activePlans(product).find((plan) => plan.durationMonths === durationMonths) ?? null
}

/** The dose surcharges, which apply on their own once the dose is above them. */
export function automaticAddons(product: SubscriptionProduct): CatalogAddon[] {
  return product.addons.filter((addon) => addon.isActive && addon.addonType === 'per_unit')
}

/** The optional extras — MCT oil, propionate, the topical surcharge. */
export function selectableAddons(product: SubscriptionProduct): CatalogAddon[] {
  return product.addons.filter((addon) => addon.isActive && addon.addonType === 'flat')
}

/**
 * The add-ons to price a protocol with: every dose surcharge, plus the optional
 * extras somebody actually chose.
 *
 * A `per_unit` add-on is never selected by hand. It is the surcharge for a dose
 * above the included amount — $3.75 per 10mg over 200mg on the injectables — and
 * leaving it to a checkbox would mean a high dose could be sold at the standard
 * price by forgetting to tick it.
 */
export function addonsFor(product: SubscriptionProduct, selectedIds: number[] = []): Addon[] {
  const chosen = new Set(selectedIds)

  const applicable = product.addons.filter(
    (addon) => addon.isActive && (addon.addonType === 'per_unit' || chosen.has(addon.id))
  )

  return applicable.map((addon) =>
    addon.addonType === 'per_unit'
      ? {
          kind: 'per_unit' as const,
          name: addon.name,
          pricePerUnit: addon.pricePerUnit,
          threshold: addon.threshold ?? 0,
          unitSize: addon.unitSize ?? 1,
        }
      : { kind: 'flat' as const, name: addon.name, amount: addon.pricePerUnit }
  )
}

/** Testosterone in any form: the cypionate, the enanthate, the cream, the gel. */
function isTrt(product: SubscriptionProduct): boolean {
  return product.name.toLowerCase().includes('testosterone')
}

/** Testosterone or enclomiphene, which is what `hormone_therapy` covers. */
function isHormoneTherapy(product: SubscriptionProduct): boolean {
  const name = product.name.toLowerCase()
  return name.includes('testosterone') || name.includes('enclomiphene')
}

function isOffered(discount: CatalogDiscount, product: SubscriptionProduct): boolean {
  switch (discount.appliesTo) {
    case 'all':
      return true
    case 'hormone_therapy':
      return isHormoneTherapy(product)
    case 'trt_only':
      return isTrt(product)
  }
}

/**
 * The discounts a product may be given, in the order they come off.
 *
 * Priority order is preserved because it decides how they stack, and stacking is
 * worth money — see the note at the top of `discounts.ts`. Filtering by audience
 * here rather than at the point of application means an ineligible discount can
 * never reach the arithmetic: the admin app checks the same rule, but in a
 * `useMemo` in the browser.
 *
 * Expiry is checked against `now` because the column exists and nothing else
 * looks at it. Nothing in the catalog is dated today, so this is a latent rule
 * rather than an observed one.
 */
export function eligibleDiscounts(
  catalog: PricingCatalog,
  product: SubscriptionProduct,
  now: Date = new Date()
): CatalogDiscount[] {
  return catalog.discounts
    .filter((discount) => discount.isActive && isOffered(discount, product))
    .filter((discount) => !discount.expiresAt || new Date(discount.expiresAt) > now)
    .sort((a, b) => a.priority - b.priority)
}

/**
 * A catalog discount as the engine takes it, label and all.
 *
 * The label is built here because this is where both halves are known — the
 * configuration and the scope it applies at — and because the result is stored on
 * the snapshot and read back by the patient pages. See `labels.ts`.
 */
export function toDiscount(discount: CatalogDiscount): Discount {
  if (discount.kind === 'percentage') {
    const percent = discount.percent
    const label =
      discount.scope === 'first_month'
        ? firstMonthPercentageLabel(discount.name, percent)
        : discount.scope === 'overall'
          ? overallPercentageLabel(discount.name, percent)
          : monthlyPercentageLabel(discount.name, percent)

    return { kind: 'percentage', scope: discount.scope, label, percent }
  }

  const amount = discount.amount
  const label =
    discount.scope === 'first_month'
      ? firstMonthFixedLabel(discount.name, amount)
      : discount.scope === 'overall'
        ? overallFixedLabel(discount.name, amount)
        : monthlyFixedLabel(discount.name, amount)

  return { kind: 'fixed', scope: discount.scope, label, amount }
}

/** The chosen discounts, ready to price, in the order they come off. */
export function discountsFor(
  catalog: PricingCatalog,
  product: SubscriptionProduct,
  selectedIds: number[],
  now: Date = new Date()
): Discount[] {
  const chosen = new Set(selectedIds)

  return eligibleDiscounts(catalog, product, now)
    .filter((discount) => chosen.has(discount.id))
    .map(toDiscount)
}

// ---------------------------------------------------------------------------
// Reading the rows
// ---------------------------------------------------------------------------

/**
 * The columns each shape above needs, as PostgREST wants them asked for.
 *
 * Beside the parsers rather than in the loader so that the query and the type it
 * produces cannot drift apart, and so a script can read the catalog exactly the
 * way the app does without a second copy of the column list.
 */
export const SUBSCRIPTION_SELECT = `
  id, medication_id, name, base_monthly_price, is_taxable, tax_rate, is_active,
  subscription_prepayment_plans (
    id, duration_months, monthly_price, label, sort_order, is_active
  ),
  subscription_addons (
    id, name, addon_type, price_per_unit, threshold, unit_size, is_active
  )
`

export const ANCILLARY_SELECT = `
  id, medication_id, name, pricing_model, base_price, processing_fee,
  is_taxable, tax_rate, is_active, sort_order,
  ancillary_pricing_tiers (
    id, label, price, default_quantity, sort_order, is_active
  )
`

export const DISCOUNT_SELECT = `
  id, name, code, discount_type, value, applies_to, scope, priority,
  is_active, expiration_date
`

/** A `numeric` column, which the driver is entitled to hand back as a string. */
type Numeric = number | string | null

export type SubscriptionRow = {
  id: number
  medication_id: number
  name: string
  base_monthly_price: Numeric
  is_taxable: boolean | null
  tax_rate: Numeric
  is_active: boolean | null
  subscription_prepayment_plans: {
    id: number
    duration_months: number
    monthly_price: Numeric
    label: string | null
    sort_order: number | null
    is_active: boolean | null
  }[]
  subscription_addons: {
    id: number
    name: string
    addon_type: string
    price_per_unit: Numeric
    threshold: Numeric
    unit_size: Numeric
    is_active: boolean | null
  }[]
}

export type AncillaryRow = {
  id: number
  medication_id: number | null
  name: string
  pricing_model: string
  base_price: Numeric
  processing_fee: Numeric
  is_taxable: boolean | null
  tax_rate: Numeric
  is_active: boolean | null
  sort_order: number | null
  ancillary_pricing_tiers: {
    id: number
    label: string
    price: Numeric
    default_quantity: number | null
    sort_order: number | null
    is_active: boolean | null
  }[]
}

export type DiscountRow = {
  id: number
  name: string
  code: string | null
  discount_type: string
  value: Numeric
  applies_to: string | null
  scope: string | null
  priority: number | null
  is_active: boolean | null
  expiration_date: string | null
}

/** A rate or a count, which is not money and so is not cents. */
function toNumber(value: Numeric): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  return Number.isFinite(parsed) ? (parsed as number) : 0
}

/** A threshold or unit size, where absent and zero mean different things. */
function toOptionalNumber(value: Numeric): number | null {
  if (value === null) return null
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  return Number.isFinite(parsed) ? (parsed as number) : null
}

/**
 * `addon_type`, `pricing_model`, `applies_to` and `scope` are all plain text
 * columns with nothing constraining them, so an unrecognised value is possible and
 * each falls back to the column's own default.
 *
 * Except `applies_to`, which falls back to the *narrowest* audience rather than
 * its default of `all`. An unreadable audience should mean a discount nobody is
 * offered — noticed the first time someone asks why it is missing — rather than
 * one everybody is, discovered in the takings.
 */
function toAddonType(value: string): 'per_unit' | 'flat' {
  return value === 'flat' ? 'flat' : 'per_unit'
}

const PRICING_MODELS: AncillaryPricingModel[] = [
  'flat',
  'per_capsule',
  'tiered',
  'included',
  'external_referral',
]

function toPricingModel(value: string): AncillaryPricingModel {
  return PRICING_MODELS.includes(value as AncillaryPricingModel)
    ? (value as AncillaryPricingModel)
    : 'flat'
}

const AUDIENCES: DiscountAudience[] = ['all', 'hormone_therapy', 'trt_only']

function toAudience(value: string | null): DiscountAudience {
  return AUDIENCES.includes(value as DiscountAudience) ? (value as DiscountAudience) : 'trt_only'
}

const SCOPES: DiscountScope[] = ['monthly', 'first_month', 'overall']

function toScope(value: string | null): DiscountScope {
  return SCOPES.includes(value as DiscountScope) ? (value as DiscountScope) : 'monthly'
}

export function parseSubscriptionProduct(row: SubscriptionRow): SubscriptionProduct {
  return {
    id: row.id,
    medicationId: row.medication_id,
    name: row.name,
    baseMonthlyPrice: fromNumeric(row.base_monthly_price),
    isTaxable: row.is_taxable ?? false,
    taxRate: toNumber(row.tax_rate),
    isActive: row.is_active ?? true,
    plans: (row.subscription_prepayment_plans ?? []).map((plan) => ({
      id: plan.id,
      durationMonths: plan.duration_months,
      monthlyPrice: fromNumeric(plan.monthly_price),
      label: plan.label,
      sortOrder: plan.sort_order ?? 0,
      isActive: plan.is_active ?? true,
    })),
    addons: (row.subscription_addons ?? []).map((addon) => ({
      id: addon.id,
      name: addon.name,
      addonType: toAddonType(addon.addon_type),
      pricePerUnit: fromNumeric(addon.price_per_unit),
      threshold: toOptionalNumber(addon.threshold),
      unitSize: toOptionalNumber(addon.unit_size),
      isActive: addon.is_active ?? true,
    })),
  }
}

export function parseAncillaryProduct(row: AncillaryRow): AncillaryProduct {
  return {
    id: row.id,
    medicationId: row.medication_id,
    name: row.name,
    pricingModel: toPricingModel(row.pricing_model),
    basePrice: fromNumeric(row.base_price),
    processingFee: fromNumeric(row.processing_fee),
    isTaxable: row.is_taxable ?? false,
    taxRate: toNumber(row.tax_rate),
    isActive: row.is_active ?? true,
    sortOrder: row.sort_order ?? 0,
    tiers: (row.ancillary_pricing_tiers ?? []).map((tier) => ({
      id: tier.id,
      label: tier.label,
      price: fromNumeric(tier.price),
      defaultQuantity: tier.default_quantity,
      sortOrder: tier.sort_order ?? 0,
      isActive: tier.is_active ?? true,
    })),
  }
}

export function parseCatalogDiscount(row: DiscountRow): CatalogDiscount {
  const common = {
    id: row.id,
    name: row.name,
    code: row.code,
    appliesTo: toAudience(row.applies_to),
    scope: toScope(row.scope),
    priority: row.priority ?? 0,
    isActive: row.is_active ?? true,
    expiresAt: row.expiration_date,
  }

  return row.discount_type === 'fixed'
    ? { ...common, kind: 'fixed', amount: fromNumeric(row.value) }
    : { ...common, kind: 'percentage', percent: toNumber(row.value) }
}
