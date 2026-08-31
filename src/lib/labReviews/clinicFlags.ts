/**
 * AlphaMD Clinic flags for the lab-values strip.
 *
 * These are attention cues, not the lab's printed range and not a Disposition.
 * Hematocrit > 51 and Estradiol ≥ 50 are Saba's dose-change lines (ALP-1).
 * The companions are the v1 suggestions so a Provider notices; the list is
 * expected to move when her written thresholds arrive.
 *
 * Total T, Free T, SHBG and LH are unlisted on purpose — see ADR 0004.
 */

export type ClinicFlag = 'yellow' | 'red'

type Bound = 'exact' | 'gt' | 'lt'

type Parsed = { n: number; bound: Bound; unit: string }

type Spec = {
  yellowFrom: number
  redFrom: number
  /** Red is ≥ redFrom when true, > redFrom when false. */
  redInclusive: boolean
  unit: 'percent-or-bare' | 'pg/ml' | 'g/dl' | 'ng/ml'
}

const SPECS: Record<string, Spec> = {
  Hematocrit: { yellowFrom: 50, redFrom: 51, redInclusive: false, unit: 'percent-or-bare' },
  Estradiol: { yellowFrom: 40, redFrom: 50, redInclusive: true, unit: 'pg/ml' },
  Hemoglobin: { yellowFrom: 16.5, redFrom: 17.5, redInclusive: false, unit: 'g/dl' },
  PSA: { yellowFrom: 2.5, redFrom: 4, redInclusive: true, unit: 'ng/ml' },
  Prolactin: { yellowFrom: 20, redFrom: 30, redInclusive: true, unit: 'ng/ml' },
}

const VALUE = /^\s*([<>])?\s*(\d+(?:\.\d+)?)\s*(.*?)\s*$/

/**
 * The Clinic flag for one extracted display string, or null when we cannot
 * prove the value has reached a threshold — wrong name, unreadable string,
 * mismatched unit, or a less-than that never proves a high line.
 */
export function clinicFlag(name: string, value: string): ClinicFlag | null {
  const spec = SPECS[name]
  if (!spec) return null

  const parsed = parseValue(value)
  if (!parsed || !unitMatches(parsed.unit, spec.unit)) return null

  if (provesAtLeast(parsed, spec.redFrom, spec.redInclusive)) return 'red'
  if (provesAtLeast(parsed, spec.yellowFrom, true)) return 'yellow'
  return null
}

function parseValue(value: string): Parsed | null {
  const match = value.match(VALUE)
  if (!match) return null

  const n = Number(match[2])
  if (!Number.isFinite(n)) return null

  const bound: Bound = match[1] === '>' ? 'gt' : match[1] === '<' ? 'lt' : 'exact'
  return { n, bound, unit: match[3] }
}

/**
 * Can we prove the true value is ≥ (or >) the line?
 *
 * `>N` on the report means (N, ∞): that proves a high line when N itself has
 * already reached it. `<N` is (−∞, N) and never proves a high line.
 */
function provesAtLeast(parsed: Parsed, line: number, inclusive: boolean): boolean {
  if (parsed.bound === 'lt') return false

  if (parsed.bound === 'exact') {
    return inclusive ? parsed.n >= line : parsed.n > line
  }

  // bound === 'gt': every possible value is > parsed.n
  return parsed.n >= line
}

function unitMatches(unit: string, expected: Spec['unit']): boolean {
  const normalized = unit.toLowerCase().replace(/\s+/g, '')

  if (expected === 'percent-or-bare') return normalized === '%' || normalized === ''
  if (normalized.includes('%')) return false

  if (expected === 'pg/ml') return normalized === 'pg/ml'
  if (expected === 'ng/ml') return normalized === 'ng/ml'
  if (expected === 'g/dl') return normalized === 'g/dl' || normalized === 'gm/dl'
  return false
}
