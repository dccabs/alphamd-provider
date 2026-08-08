// Provider portal email allowlist. Dependency-free so it is safe to import into
// the proxy bundle. Ported from alphamd's utils/adminAllowedEmail.ts.

export const PROVIDER_ALLOWED_EMAIL_DOMAIN = 'alphamd.org'

// Optional exact-address exceptions, controlled by deploy-time env config.
// Comma/whitespace separated. Parsed once at module load (env is static per
// deploy), so changes require a redeploy to take effect.
const ALLOWED_EMAILS = new Set(
  (process.env.PROVIDER_ALLOWED_EMAILS || '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
)

export const isAllowedProviderEmail = (
  email: string | null | undefined
): boolean => {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  if (ALLOWED_EMAILS.has(normalized)) return true
  // Exact domain match (parse after the last '@') to avoid suffix-spoofing
  // like foo@notalphamd.org or foo@alphamd.org.evil.com.
  const at = normalized.lastIndexOf('@')
  if (at === -1) return false
  return normalized.slice(at + 1) === PROVIDER_ALLOWED_EMAIL_DOMAIN
}
