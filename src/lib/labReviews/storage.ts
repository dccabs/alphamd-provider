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

/** PostgREST caps the URL length, and `.in()` puts every key in the query
 *  string. Patients top out at 59 files today, so this only ever splits in two. */
const MIME_LOOKUP_BATCH = 50

/**
 * The real content type of each stored file, keyed by the path as given.
 *
 * `user_files` has no MIME column — the truth is `storage.objects.metadata`,
 * which the service role can read through PostgREST's `storage` schema. It
 * matters because the stored extension lies: 1,847 of the 1,849 `.xlsx` paths
 * are really PDFs or images (see `files.ts`).
 *
 * A failure here degrades to extension-based classification rather than
 * throwing. Losing a type label is a cosmetic problem; failing the whole lab
 * review page over one is not a trade a clinical screen should make.
 */
export async function getLabFileMimeTypes(
  storedPaths: string[]
): Promise<Map<string, string>> {
  const byStoredPath = new Map<string, string>()
  if (!storedPaths.length) return byStoredPath

  const admin = createAdminClient()
  const keyByPath = new Map(storedPaths.map((path) => [path, pathWithinBucket(path)]))
  const keys = [...new Set(keyByPath.values())]

  const batches: string[][] = []
  for (let i = 0; i < keys.length; i += MIME_LOOKUP_BATCH) {
    batches.push(keys.slice(i, i + MIME_LOOKUP_BATCH))
  }

  const results = await Promise.all(
    batches.map((batch) =>
      admin
        .schema('storage')
        .from('objects')
        .select('name, metadata')
        .eq('bucket_id', LAB_FILE_BUCKET)
        .in('name', batch)
    )
  )

  const mimeByKey = new Map<string, string>()
  for (const { data, error } of results) {
    if (error) {
      console.error('Failed to read lab file MIME types', { message: error.message })
      continue
    }
    for (const row of data ?? []) {
      const mimeType = (row.metadata as { mimetype?: string } | null)?.mimetype
      if (mimeType) mimeByKey.set(row.name as string, mimeType)
    }
  }

  for (const [path, key] of keyByPath) {
    const mimeType = mimeByKey.get(key)
    if (mimeType) byStoredPath.set(path, mimeType)
  }
  return byStoredPath
}
