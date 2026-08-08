import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. **Server-only — never import from a client
 * component.**
 *
 * Why this exists at all: every table this portal reads for a lab review is
 * gated by RLS on `is_admin_or_employee()`, which checks the legacy
 * single-value `user_list.role` column. No account in production has
 * `user_list.role = 'provider'`, so a real provider reading through RLS gets
 * empty arrays rather than an error — the worst possible failure mode on a
 * clinical screen. Authorization is therefore enforced in application code
 * (`requireProviderAccess` in `@/lib/authz`), not by RLS.
 *
 * Containment, in layers:
 *  - `import 'server-only'` above makes importing this from a client component
 *    a build error, not a runtime surprise;
 *  - eslint.config.mjs additionally bans the import from `'use client'` files;
 *  - every caller runs `requireProviderAccess()` before touching patient data.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY

  if (!url || !secret) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set to read lab reviews.'
    )
  }

  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
