/**
 * Lab file classification. Dependency-free and pure so it can be unit-tested
 * and used from both server and client components.
 *
 * Why this exists: the design's viewer assumes a paginated PDF, but in the
 * `original-test-results` bucket over the last 365 days only 8,864 of 10,435
 * files are PDFs. 1,538 (14.7%) are raster images with no pages at all, and 33
 * are HEIC — which Chrome and Firefox cannot render, so embedding them shows a
 * broken image with no explanation. A further ~34 are docx/xlsx/tiff/dng or
 * have no usable extension.
 */

export type FileKind = 'pdf' | 'image' | 'unsupported'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

/** Extensions that are images but that browsers other than Safari cannot
 *  decode. Treated as unsupported so the user gets a download instead of a
 *  silently broken <img>. */
const UNRENDERABLE_IMAGE_EXTENSIONS = new Set(['heic', 'heif'])

export function fileExtension(fileName: string | null | undefined): string {
  if (!fileName) return ''
  // Strip any query string, then take the segment after the last dot of the
  // last path segment. "a.b/c" must not report an extension of "b/c".
  const path = fileName.split('?')[0]
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function classifyFile(fileName: string | null | undefined): FileKind {
  const ext = fileExtension(fileName)
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  // HEIC/HEIF fall through to unsupported deliberately — see above.
  return 'unsupported'
}

/** True when the browser cannot render it but it is still an image, which is
 *  worth saying out loud in the fallback copy. */
export function isUnrenderableImage(fileName: string | null | undefined): boolean {
  return UNRENDERABLE_IMAGE_EXTENSIONS.has(fileExtension(fileName))
}

/** Human label for the Files list, e.g. "PDF" / "JPEG image" / "HEIC file". */
export function fileKindLabel(fileName: string | null | undefined): string {
  const ext = fileExtension(fileName)
  if (!ext) return 'File'
  if (ext === 'pdf') return 'PDF'
  if (IMAGE_EXTENSIONS.has(ext)) return `${ext.toUpperCase()} image`
  // Some stored names use a whole MIME type where an extension should be, e.g.
  // `…​.vnd.openxmlformats-officedocument.wordprocessingml.document`. Shouting
  // "DOCUMENT file" (or worse) at the provider helps nobody, so anything longer
  // than a plausible extension just reads as "File".
  if (ext.length > 5) return 'File'
  return `${ext.toUpperCase()} file`
}

/**
 * Just the type token — `PDF`, `XLSX`, `HEIC` — for sentences like
 * "XLSX files cannot be shown inline". Distinct from `fileKindLabel`, which is
 * a noun phrase for the file list; interpolating that one into a sentence
 * produces "XLSX file files".
 */
export function fileTypeName(fileName: string | null | undefined): string {
  const ext = fileExtension(fileName)
  if (!ext || ext.length > 5) return 'These'
  return ext.toUpperCase()
}

/** Display name for a stored path like `original-test-results/<uuid>/foo.pdf`. */
export function displayFileName(
  storedPath: string | null | undefined,
  userFileName?: string | null
): string {
  if (userFileName) return userFileName
  if (!storedPath) return 'Untitled file'
  const base = storedPath.slice(storedPath.lastIndexOf('/') + 1)
  return base || storedPath
}
