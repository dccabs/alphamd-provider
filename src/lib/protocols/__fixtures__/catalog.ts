import type {
  AncillaryProduct,
  CatalogDiscount,
  PricingCatalog,
  SubscriptionProduct,
} from '../catalog.ts'
import { fromNumeric } from '../money.ts'

/**
 * The pricing catalog as production holds it, for tests to work against.
 *
 * Transcribed from the six tables rather than invented, because the interesting
 * cases are all real ones: Sermorelin stocked twice at different prices,
 * Enclomiphene sold with no three-month term, Anavar and Nandrolone withdrawn
 * rather than deleted, a discount named "Newsletter (first month only)" that is
 * applied at overall scope, and a dose surcharge that applies without anyone
 * ticking a box.
 *
 * Trimmed to the products those cases need. It is a fixture, not a mirror — if a
 * test starts depending on a product that is not here, add it from the catalog
 * rather than making one up.
 */

const plan = (id: number, durationMonths: number, monthly: number, sortOrder = 0) => ({
  id,
  durationMonths,
  monthlyPrice: fromNumeric(monthly),
  label: null,
  sortOrder,
  isActive: true,
})

/** $3.75 for every 10mg above 200, on the injectables. */
const doseSurcharge = {
  id: 1,
  name: 'Dosage Surcharge',
  addonType: 'per_unit' as const,
  pricePerUnit: fromNumeric(3.75),
  threshold: 200,
  unitSize: 10,
  isActive: true,
}

const cypionate: SubscriptionProduct = {
  id: 1,
  medicationId: 1,
  name: 'Testosterone Cypionate',
  baseMonthlyPrice: fromNumeric(129),
  isTaxable: true,
  taxRate: 0.065,
  isActive: true,
  plans: [plan(1, 1, 129, 1), plan(2, 3, 119, 2), plan(3, 6, 109, 3), plan(4, 12, 98, 4)],
  addons: [
    doseSurcharge,
    { ...doseSurcharge, id: 5, name: 'MCT Oil', addonType: 'flat', pricePerUnit: fromNumeric(50) },
    {
      ...doseSurcharge,
      id: 6,
      name: 'Propionate',
      addonType: 'flat',
      pricePerUnit: fromNumeric(50),
    },
  ],
}

/** Every plan at `sort_order` 0, which is why plans sort by duration as well. */
const cream: SubscriptionProduct = {
  id: 4,
  medicationId: 30,
  name: 'Testosterone Cream',
  baseMonthlyPrice: fromNumeric(129),
  isTaxable: true,
  taxRate: 0.065,
  isActive: true,
  plans: [plan(10, 1, 129, 1), plan(14, 3, 119), plan(15, 6, 109), plan(16, 12, 98)],
  addons: [
    {
      id: 4,
      name: 'Topical Surcharge',
      addonType: 'flat',
      pricePerUnit: fromNumeric(50),
      threshold: null,
      unitSize: null,
      isActive: true,
    },
  ],
}

/** Sold monthly, six and twelve months. There is no three-month term. */
const enclomiphene: SubscriptionProduct = {
  id: 5,
  medicationId: 29,
  name: 'Enclomiphene Subscription',
  baseMonthlyPrice: fromNumeric(159),
  isTaxable: false,
  taxRate: 0,
  isActive: true,
  plans: [plan(11, 1, 159, 1), plan(20, 6, 139), plan(21, 12, 129)],
  addons: [],
}

const semaglutide: SubscriptionProduct = {
  id: 6,
  medicationId: 23,
  name: 'Semaglutide',
  baseMonthlyPrice: fromNumeric(286),
  isTaxable: false,
  taxRate: 0,
  isActive: true,
  plans: [plan(12, 1, 286, 1)],
  addons: [],
}

const ancillary = (
  overrides: Partial<AncillaryProduct> & Pick<AncillaryProduct, 'id' | 'name'>
): AncillaryProduct => ({
  medicationId: null,
  pricingModel: 'flat',
  basePrice: fromNumeric(0),
  processingFee: fromNumeric(0),
  isTaxable: false,
  taxRate: 0,
  isActive: true,
  sortOrder: 0,
  tiers: [],
  ...overrides,
})

const anastrozole = ancillary({
  id: 8,
  medicationId: 13,
  name: 'Anastrozole',
  pricingModel: 'included',
})

const hcg = ancillary({
  id: 1,
  medicationId: 16,
  name: 'HCG 10,000 units',
  basePrice: fromNumeric(300),
})

/** Two active products, one medication, priced by where the patient lives. */
const sermorelinCalifornia = ancillary({
  id: 13,
  medicationId: 31,
  name: 'Sermorelin (California)',
  basePrice: fromNumeric(264.99),
})

const sermorelinElsewhere = ancillary({
  id: 4,
  medicationId: 31,
  name: 'Sermorelin (non California)',
  basePrice: fromNumeric(229.99),
})

/** Withdrawn rather than deleted. The clinic no longer offers either. */
const anavar = ancillary({
  id: 2,
  medicationId: 25,
  name: 'Anavar (Oxandrolone)',
  pricingModel: 'tiered',
  isActive: false,
  tiers: [
    { id: 1, label: '10mg', price: fromNumeric(120), defaultQuantity: null, sortOrder: 1, isActive: true },
  ],
})

const enclomipheneAncillary = ancillary({
  id: 7,
  medicationId: 33,
  name: 'Enclomiphene (ancillary)',
  pricingModel: 'per_capsule',
  processingFee: fromNumeric(15),
  tiers: [
    { id: 10, label: '12.5mg', price: fromNumeric(2.5), defaultQuantity: 30, sortOrder: 1, isActive: true },
    { id: 11, label: '25mg', price: fromNumeric(3), defaultQuantity: 30, sortOrder: 2, isActive: true },
  ],
})

const enclomiphenePct = ancillary({
  id: 12,
  medicationId: 34,
  name: 'Enclomiphene PCT',
  pricingModel: 'tiered',
  tiers: [
    { id: 20, label: '12.5mg × 30', price: fromNumeric(99), defaultQuantity: null, sortOrder: 1, isActive: true },
  ],
})

const discount = (
  id: number,
  name: string,
  appliesTo: CatalogDiscount['appliesTo'],
  scope: CatalogDiscount['scope'],
  priority: number,
  value: { percent: number } | { fixed: number }
): CatalogDiscount => ({
  id,
  name,
  code: null,
  appliesTo,
  scope,
  priority,
  isActive: true,
  expiresAt: null,
  ...('percent' in value
    ? { kind: 'percentage' as const, percent: value.percent }
    : { kind: 'fixed' as const, amount: fromNumeric(value.fixed) }),
})

export const DISCOUNTS: CatalogDiscount[] = [
  discount(1, 'Military/First Responder', 'hormone_therapy', 'monthly', 1, { percent: 20 }),
  discount(2, 'Weight Loss Program', 'trt_only', 'monthly', 2, { percent: 25 }),
  discount(3, 'Household/Spouses', 'all', 'monthly', 3, { percent: 12.5 }),
  discount(4, 'Friends/Family', 'all', 'monthly', 4, { fixed: 30 }),
  discount(5, 'Female TRT', 'trt_only', 'monthly', 5, { fixed: 10 }),
  discount(6, 'Newsletter (first month only)', 'hormone_therapy', 'overall', 1, { fixed: 30 }),
]

export const PRODUCTS = {
  cypionate,
  cream,
  enclomiphene,
  semaglutide,
}

export const ANCILLARIES = {
  anastrozole,
  hcg,
  sermorelinCalifornia,
  sermorelinElsewhere,
  anavar,
  enclomipheneAncillary,
  enclomiphenePct,
}

export function testCatalog(): PricingCatalog {
  return {
    subscriptions: Object.values(PRODUCTS),
    ancillaries: Object.values(ANCILLARIES),
    discounts: DISCOUNTS,
  }
}
