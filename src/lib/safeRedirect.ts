// Same-origin redirect sanitiser, shared by everything that honours a
// caller-supplied `?redirect=` / `?next=` value. Dependency-free so it is safe
// to import into the proxy bundle.

const SENTINEL_ORIGIN = 'http://internal.invalid'

/**
 * Returns `value` only if it is a plain path on this origin; otherwise
 * `fallback`.
 *
 * Prefix checks alone are not enough. Browsers normalise backslashes to
 * forward slashes while parsing, so `/\evil.com` starts with a single `/`
 * but resolves to the protocol-relative `//evil.com`. Parsing against a
 * sentinel origin and comparing the result catches that, and every other
 * encoding of the same trick, the same way the browser will.
 */
export const safeRedirectPath = (
  value: string | null | undefined,
  fallback = '/'
): string => {
  if (!value || !value.startsWith('/')) return fallback
  try {
    const url = new URL(value, SENTINEL_ORIGIN)
    if (url.origin !== SENTINEL_ORIGIN) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
