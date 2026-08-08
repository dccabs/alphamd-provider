/**
 * Lab file classification. Dependency-free and pure so it can be unit-tested
 * and used from both server and client components.
 *
 * Why this exists: the design's viewer assumes a paginated PDF, but the
 * `original-test-results` bucket holds images, HEICs and the odd Office
 * document too. HEIC in particular cannot be decoded by Chrome or Firefox, so
 * embedding it shows a broken image with no explanation.
 *
 * **The stored extension is not trustworthy.** 1,849 of the 14,461 `user_files`
 * paths end in `.xlsx`, but the bucket metadata says only *2* of them are
 * actually spreadsheets: 1,276 are `application/pdf`, 380 `image/jpeg`, 190
 * `image/png` and one `image/heic`. Some paths end in `.undefined` or have no
 * extension at all. So every function here takes the storage MIME type and only
 * falls back to the extension when the MIME type is missing or uninformative —
 * which also means those ~1,847 files preview properly instead of being written
 * off as unsupported spreadsheets.
 */

export type FileKind = 'pdf' | 'image' | 'unsupported'

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

/** Extensions that are images but that browsers other than Safari cannot
 *  decode. Treated as unsupported so the user gets a download instead of a
 *  silently broken <img>. */
const UNRENDERABLE_IMAGE_EXTENSIONS = new Set(['heic', 'heif'])

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const UNRENDERABLE_IMAGE_MIME_TYPES = new Set(['image/heic', 'image/heif'])

/**
 * MIME types that carry no information. Uploaders that failed to detect a type
 * send these, so they must defer to the extension rather than condemning the
 * file to a download.
 */
const UNINFORMATIVE_MIME_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
])

function normalizeMimeType(mimeType: string | null | undefined): string {
  // Strip any `; charset=…` parameter and casing, e.g. `text/plain; charset=utf-8`.
  const bare = (mimeType ?? '').split(';')[0].trim().toLowerCase()
  return UNINFORMATIVE_MIME_TYPES.has(bare) ? '' : bare
}

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

export function classifyFile(
  fileName: string | null | undefined,
  mimeType?: string | null
): FileKind {
  const mime = normalizeMimeType(mimeType)
  if (mime) {
    if (mime === 'application/pdf') return 'pdf'
    if (IMAGE_MIME_TYPES.has(mime)) return 'image'
    // Every other known type — including HEIC, TIFF and DNG, which are images
    // no browser here can be relied on to decode — gets a download.
    return 'unsupported'
  }

  const ext = fileExtension(fileName)
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'unsupported'
}

/** True when the browser cannot render it but it is still an image, which is
 *  worth saying out loud in the fallback copy. */
export function isUnrenderableImage(
  fileName: string | null | undefined,
  mimeType?: string | null
): boolean {
  const mime = normalizeMimeType(mimeType)
  if (mime) return UNRENDERABLE_IMAGE_MIME_TYPES.has(mime)
  return UNRENDERABLE_IMAGE_EXTENSIONS.has(fileExtension(fileName))
}

/** Noun phrases for the Files list. Covers every MIME type present in the
 *  bucket, plus the close relatives a future upload could plausibly carry. */
const MIME_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG image',
  'image/png': 'PNG image',
  'image/webp': 'WEBP image',
  'image/gif': 'GIF image',
  'image/heic': 'HEIC image',
  'image/heif': 'HEIF image',
  'image/tiff': 'TIFF image',
  'image/x-adobe-dng': 'DNG image',
  'application/msword': 'Word document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.ms-excel': 'Spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Spreadsheet',
  'text/plain': 'Text file',
  'text/csv': 'CSV file',
  'text/html': 'HTML file',
  'text/xml': 'XML file',
  'application/xml': 'XML file',
  'application/zip': 'ZIP archive',
  'application/x-zip-compressed': 'ZIP archive',
}

/** Canonical extension per type, for naming a download. */
const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
  'image/x-adobe-dng': 'dng',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

/** Only these are stripped off a display name, so `Results v1.2` keeps its `.2`. */
const REPLACEABLE_EXTENSIONS = new Set([
  ...Object.values(MIME_TYPE_EXTENSIONS),
  'jpeg',
  'tif',
  'htm',
])

/**
 * What the file should be saved as.
 *
 * The stored path's extension is wrong for 1,847 files, and the display name
 * has had its extension dropped for generated names, so neither is usable on
 * its own: a PDF saved as `<uuid>.xlsx` opens to an error, and one saved as
 * `<uuid>` opens to nothing. The MIME type decides the extension; the stored
 * one is only a fallback for objects with no metadata.
 */
export function downloadFileName(
  displayName: string,
  storedPath: string | null | undefined,
  mimeType?: string | null
): string {
  const mime = normalizeMimeType(mimeType)
  const extension = MIME_TYPE_EXTENSIONS[mime] || fileExtension(storedPath)
  if (!extension) return displayName

  const dot = displayName.lastIndexOf('.')
  const current = dot > 0 ? displayName.slice(dot + 1).toLowerCase() : ''
  // `.jpeg` is not worth rewriting to `.jpg`.
  if (current === extension || (extension === 'jpg' && current === 'jpeg')) return displayName

  const stem = REPLACEABLE_EXTENSIONS.has(current) ? displayName.slice(0, dot) : displayName
  return `${stem}.${extension}`
}

/** Short type tokens for sentences like "PDF files cannot be shown inline". */
const MIME_TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/heic': 'HEIC',
  'image/heif': 'HEIF',
  'image/tiff': 'TIFF',
  'image/x-adobe-dng': 'DNG',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'text/html': 'HTML',
  'text/xml': 'XML',
  'application/xml': 'XML',
  'application/zip': 'ZIP',
  'application/x-zip-compressed': 'ZIP',
}

/** Human label for the Files list, e.g. "PDF" / "JPEG image" / "HEIC image". */
export function fileKindLabel(
  fileName: string | null | undefined,
  mimeType?: string | null
): string {
  const mime = normalizeMimeType(mimeType)
  if (mime) {
    const known = MIME_TYPE_LABELS[mime]
    if (known) return known
    // An unmapped image subtype still reads sensibly; anything else would only
    // expose a MIME string a provider has no use for.
    const [type, subtype] = mime.split('/')
    return type === 'image' && subtype ? `${subtype.toUpperCase()} image` : 'File'
  }

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
 * Just the type token — `PDF`, `HEIC`, `Word` — for sentences like
 * "Word files cannot be shown inline". Distinct from `fileKindLabel`, which is
 * a noun phrase for the file list; interpolating that one into a sentence
 * produces "HEIC image files".
 */
export function fileTypeName(
  fileName: string | null | undefined,
  mimeType?: string | null
): string {
  const mime = normalizeMimeType(mimeType)
  if (mime) return MIME_TYPE_NAMES[mime] ?? 'These'

  const ext = fileExtension(fileName)
  if (!ext || ext.length > 5) return 'These'
  return ext.toUpperCase()
}

/**
 * Display name for a stored path like `original-test-results/<uuid>/foo.pdf`.
 *
 * A patient-supplied `user_file_name` is theirs and is shown verbatim. Failing
 * that, the basename is a generated uuid plus whatever extension the uploader
 * guessed — and that guess is wrong for 1,847 files. Since the resolved type is
 * displayed right beside the name, the extension is dropped instead of
 * repeating a guess or inventing a corrected one.
 */
export function displayFileName(
  storedPath: string | null | undefined,
  userFileName?: string | null,
  mimeType?: string | null
): string {
  if (userFileName) return userFileName
  if (!storedPath) return 'Untitled file'

  const base = storedPath.slice(storedPath.lastIndexOf('/') + 1)
  if (!base) return storedPath

  if (normalizeMimeType(mimeType)) {
    const dot = base.lastIndexOf('.')
    if (dot > 0) return base.slice(0, dot)
  }
  return base
}
