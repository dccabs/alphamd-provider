import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Lab files live in the `original-test-results` bucket, and `user_files.file_name`
 * stores the path *including* that bucket prefix, so it has to be stripped
 * before signing. (14,452 of 14,460 `user_files` rows are in this bucket; the
 * other 8 are `testimonials`, which this screen never shows.)
 *
 * Signing happens server-side with the service-role client. The alternative —
 * signing in the browser with the user's session — is subject to storage RLS,
 * which is not readable from the analytics role, so whether a pure provider can
 * sign another patient's lab file is unverified. Signing here removes the
 * question rather than leaving it to chance on a PHI screen.
 */

export const LAB_FILE_BUCKET = 'original-test-results'

/** Strip the bucket prefix if present. Exported for testing. */
export function pathWithinBucket(storedPath: string): string {
  const prefix = `${LAB_FILE_BUCKET}/`
  return storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath
}

export async function signLabFile(
  storedPath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  if (!storedPath) return null

  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(LAB_FILE_BUCKET)
    .createSignedUrl(pathWithinBucket(storedPath), expiresInSeconds)

  if (error) {
    console.error('Failed to sign lab file', { storedPath, message: error.message })
    return null
  }
  return data?.signedUrl ?? null
}
