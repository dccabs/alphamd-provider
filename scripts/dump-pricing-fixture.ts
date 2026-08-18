/**
 * Dumps real `pricing_snapshots` rows into a committed test fixture.
 *
 * The pricing engine in `src/lib/protocols` is a rewrite of the admin app's
 * calculator, and a rewrite of money math needs an oracle. This table is one:
 * every row records the *inputs* a protocol was priced from next to the
 * *outputs* that were computed, so a few hundred real protocols become the
 * specification the engine is held to.
 *
 * Run it by hand, not in CI:
 *
 *     node --env-file=.env scripts/dump-pricing-fixture.ts
 *
 * Two windows, because they answer different questions:
 *
 *   - The last 30 days is the main set. Recent enough that every row was priced
 *     by the algorithm we are reproducing, which sidesteps the question of how
 *     far back this table is still recognisable — it has been through at least
 *     one generation already, judging by the six dead columns dropped below.
 *   - Every multi-month prepay row ever written, because only 8 of them fall
 *     inside 30 days and prepay is what exercises the duration multiplication
 *     and its interaction with first-month discounts. Older ones are tagged so
 *     the test can treat a failure there as a finding about history rather than
 *     a fault in the engine.
 *
 * No patient identifiers are involved: this table holds products, prices and
 * coupon codes, and is joined to a patient only through `medication_protocols`.
 * `created_by` is left out too, since the staff member who sent a quote has
 * nothing to do with whether its arithmetic adds up.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * The 31 columns worth reading, of 37.
 *
 * Six are omitted because they are dead in every one of the recent rows and
 * would only invite an assertion against a default: `plan_id`,
 * `subtotal_monthly` and `total_monthly` are always null, `discount_breakdown`
 * and `custom_addons` never move off `'[]'::jsonb`, and `tax_monthly` never
 * moves off `0`. The admin app does not write any of them either.
 */
const COLUMNS = [
  'id',
  'created_at',
  'product_name',
  'dosage',
  'duration_months',
  'duration_label',
  'monthly_price',
  'addon_breakdown',
  'price_before_discounts',
  'tax_rate',
  'total_due_today',
  'next_billing_date',
  'product_id',
  'dosage_mg',
  'selected_addon_ids',
  'selected_discount_ids',
  'custom_discounts',
  'monthly_discount_breakdown',
  'monthly_after_discounts',
  'overall_discount_breakdown',
  'billing_period_total',
  'subtotal_after_all_discounts',
  'tax_amount',
  'total_per_month',
  'ancillary_line_items',
  'ancillary_subtotal',
  'ancillary_tax_amount',
  'ancillary_total',
  'grand_total',
  'coupon_code_applied',
].join(', ')

const OUT = path.join(
  process.cwd(),
  'src',
  'lib',
  'protocols',
  '__fixtures__',
  'snapshots.json'
)

/** Its own client rather than `createAdminClient()`: a throwaway dev script
 *  should not drag in an app module marked `server-only`. */
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY

  if (!url || !secret) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set. ' +
        'Run with: node --env-file=.env scripts/dump-pricing-fixture.ts'
    )
  }

  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Selecting by a column string leaves the driver unable to infer a row shape,
 *  and the only field this script reads is the timestamp it tags rows by. */
type Row = Record<string, unknown> & { created_at: string }

async function main() {
  const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await client()
    .from('pricing_snapshots')
    .select(COLUMNS)
    // Everything recent, plus the whole prepay tail however old it is.
    .or(`created_at.gte.${recentSince},duration_months.gt.1`)
    .order('created_at', { ascending: false })
    .limit(2000)
    .returns<Row[]>()

  if (error) throw new Error(`pricing_snapshots query failed: ${error.message}`)

  const rows = (data ?? []).map((row) => ({
    tag: row.created_at >= recentSince ? 'recent' : 'prepay-tail',
    ...row,
  }))

  const recent = rows.filter((r) => r.tag === 'recent').length

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(
    OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), recentSince, rows }, null, 2)}\n`
  )

  console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), OUT)}`)
  console.log(`  ${recent} recent, ${rows.length - recent} from the prepay tail`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
