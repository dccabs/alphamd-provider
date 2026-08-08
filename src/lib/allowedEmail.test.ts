import assert from 'node:assert/strict'
import test from 'node:test'

// The allowlist is parsed once at module load, so the env has to be set before
// the import. Hence the dynamic import rather than a static one.
process.env.PROVIDER_ALLOWED_EMAILS = 'contractor@yucaba.com'
const { isAllowedProviderEmail } = await import('./allowedEmail.ts')

const CASES: [string | null | undefined, boolean, string][] = [
  ['dan@alphamd.org', true, 'domain match'],
  ['brandons@alphamd.org', true, 'provider whose legacy user_list.role is empty'],
  ['DAN@AlphaMD.ORG', true, 'case-insensitive'],
  ['  dan@alphamd.org  ', true, 'trimmed'],
  ['contractor@yucaba.com', true, 'env allowlist'],
  ['patient@gmail.com', false, 'unrelated domain'],
  ['foo@notalphamd.org', false, 'prefix spoof'],
  ['foo@alphamd.org.evil.com', false, 'suffix spoof'],
  ['foo@alphamd.org@evil.com', false, 'double @ — parse after the last one'],
  ['alphamd.org', false, 'no @ at all'],
  ['', false, 'empty string'],
  [null, false, 'null'],
  [undefined, false, 'undefined'],
]

for (const [input, expected, why] of CASES) {
  test(`isAllowedProviderEmail(${JSON.stringify(input)}) === ${expected} — ${why}`, () => {
    assert.equal(isAllowedProviderEmail(input), expected)
  })
}
