/**
 * The lab panel's vocabulary: what order a provider reads it in, and what the
 * values are called when there is only room for a chip.
 *
 * Pure, so both the server queries that extract values and the client component
 * that renders them can share one definition rather than each carrying a copy.
 *
 * Order matters more here than it looks. `lab_review_reports.lab_analysis_results`
 * is **jsonb**, which stores object keys sorted by length then bytewise, so the
 * insertion order the extractor used is lost by the time it is read back:
 *
 *   LH · PSA · SHBG · Estradiol · Prolactin · Hematocrit · Hemoglobin ·
 *   Free Testosterone · Total Testosterone
 *
 * That puts Total Testosterone dead last on a TRT panel and Hematocrit sixth,
 * while LH and SHBG lead despite being the two least often populated (21% and
 * 31%, against 71% for Total T). Reading order therefore has to be stated.
 */

/** One extracted lab value. There is deliberately no high/low flag: the stored
 *  JSON has display strings only, and no reference-range table exists anywhere
 *  in the database — see the AI chips note in the README. */
export type Analyte = { name: string; value: string }

/**
 * The nine keys the extractor emits, in the order a provider reads them. The
 * first four are the ones that decide a TRT dose; the tail keeps Free T next to
 * Total T and Hemoglobin next to Hematocrit, leaving the two pituitary values
 * last.
 */
export const ANALYTE_ORDER = [
  'Total Testosterone',
  'Hematocrit',
  'Estradiol',
  'PSA',
  'Free Testosterone',
  'SHBG',
  'Hemoglobin',
  'LH',
  'Prolactin',
] as const

const RANK = new Map<string, number>(ANALYTE_ORDER.map((name, i) => [name, i]))

/**
 * Clinical reading order, with anything unrecognised kept after the known keys
 * in the order it arrived. A tenth analyte added by the extractor later neither
 * vanishes from the screen nor jumps the queue ahead of testosterone.
 */
export function orderAnalytes(analytes: Analyte[]): Analyte[] {
  return analytes
    .map((analyte, i) => ({ analyte, i, rank: RANK.get(analyte.name) ?? ANALYTE_ORDER.length }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ analyte }) => analyte)
}

/** One result set's worth of extracted values. 87 of 1,118 reports in production
 *  carry two to six; `fileName` is the extractor's own label for the set, such as
 *  `Combined result for 8/11/26 (2 files: Labs (2), Labs (3))`, so it describes a
 *  result set rather than naming a stored file. */
export type AnalyteCollection = {
  collectionDate: string | null
  fileName: string | null
  analytes: Analyte[]
}

const NUMERIC_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * A collection date as a comparable number, or null when there is nothing to
 * compare.
 *
 * `collectionDate` is whatever the extractor read off the report, and production
 * holds `01/15/26`, `1/16/26`, `04/11/2026`, `06-14-23`, `04/2026` and
 * `Multiple dates`. The last two are deliberately not parsed: a month with no day
 * and a phrase are not dates, and inventing one would silently order a report by
 * a value nobody wrote. Two-digit years are 2000s — every one in production is
 * 23 through 26.
 */
export function collectionTime(collectionDate: string | null): number | null {
  const raw = collectionDate?.trim()
  if (!raw) return null

  const iso = raw.match(ISO_DATE)
  if (iso) return utc(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const numeric = raw.match(NUMERIC_DATE)
  if (!numeric) return null

  const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])
  return utc(year, Number(numeric[1]), Number(numeric[2]))
}

/** Rejects an impossible month or day rather than letting `Date` roll it over
 *  into a plausible-looking date in the next month. */
function utc(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const time = Date.UTC(year, month - 1, day)
  return Number.isNaN(time) ? null : time
}

/**
 * The most recent result set on a report — the lab actually under review.
 *
 * **Array order is not chronological.** On 29 of the 87 multi-collection reports
 * in production the first entry is older than a later one, so taking `[0]` shows
 * a stale panel roughly a third of the time it matters. Dates decide instead,
 * with the earliest entry winning a tie and position used only as a last resort
 * when no date on the report can be read at all.
 */
export function latestCollection(collections: AnalyteCollection[]): AnalyteCollection | null {
  if (!collections.length) return null

  let best: AnalyteCollection | null = null
  let bestTime: number | null = null

  for (const collection of collections) {
    const time = collectionTime(collection.collectionDate)
    if (time === null) continue

    if (bestTime === null || time > bestTime) {
      best = collection
      bestTime = time
    }
  }

  return best ?? collections[0]
}
