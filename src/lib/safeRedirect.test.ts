import assert from 'node:assert/strict'
import test from 'node:test'

import { safeRedirectPath } from './safeRedirect.ts'

const CASES: [string | null | undefined, string, string][] = [
  ['/', '/', 'root'],
  ['/somewhere', '/somewhere', 'plain path'],
  ['/a/b?c=1#d', '/a/b?c=1#d', 'query and hash preserved'],
  ['//evil.com', '/', 'protocol-relative'],
  ['/\\evil.com', '/', 'backslash normalises to protocol-relative in browsers'],
  ['/\\/evil.com', '/', 'backslash + slash'],
  ['https://evil.com', '/', 'absolute url'],
  ['http://evil.com', '/', 'absolute url, http'],
  ['javascript:alert(1)', '/', 'javascript scheme'],
  ['evil.com', '/', 'bare host'],
  ['', '/', 'empty string'],
  [null, '/', 'null'],
  [undefined, '/', 'undefined'],
]

for (const [input, expected, why] of CASES) {
  test(`safeRedirectPath(${JSON.stringify(input)}) === ${JSON.stringify(expected)} — ${why}`, () => {
    assert.equal(safeRedirectPath(input), expected)
  })
}

test('honours a custom fallback', () => {
  assert.equal(safeRedirectPath('https://evil.com', '/login'), '/login')
})
