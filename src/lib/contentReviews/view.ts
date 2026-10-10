/**
 * A Sanity document as its public page shows it, for the review screen.
 *
 * Title and meta description follow the alphamd page code — `pages/resources/[slug].tsx`,
 * `pages/ask-us-anything/[slug]/index.tsx`, `pages/featured-treatments/[slug].tsx` —
 * so the reviewer approves the words Google is shown, not an approximation.
 */

export const CONTENT_REVIEW_DOCUMENT_TYPES = [
  'resources',
  'askUsAnything',
  'featuredTreatments',
] as const
export type ContentReviewDocumentType = (typeof CONTENT_REVIEW_DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABEL: Record<ContentReviewDocumentType, string> = {
  resources: 'Article',
  askUsAnything: 'Ask Us Anything',
  featuredTreatments: 'Treatment page',
}

export function isContentReviewDocumentType(value: string): value is ContentReviewDocumentType {
  return (CONTENT_REVIEW_DOCUMENT_TYPES as readonly string[]).includes(value)
}

export type ReviewSection = {
  heading: string | null
  /** Portable Text, rendered as the site renders it. */
  blocks?: unknown[]
  items?: string[]
}

export type ReviewView = {
  id: string
  rev: string
  type: ContentReviewDocumentType
  title: string
  metaDescription: string
  publicPath: string
  byline: string | null
  subtitle: string | null
  updatedAt: string | null
  sections: ReviewSection[]
}

export type SanityReviewDocument = {
  _id: string
  _rev: string
  _type: string
  _updatedAt?: string
  [field: string]: unknown
}

/** A path or href on the public site, absolute so it opens there and not in this portal. */
export function publicSiteUrl(
  pathOrHref: string,
  base = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.net'
): string {
  if (!pathOrHref.startsWith('/')) return pathOrHref
  return `${base.replace(/\/+$/, '')}${pathOrHref}`
}

/** `utils/text.ts` `truncate` in alphamd. */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}

/** `extractTextFromSanityRichText` in alphamd, including its spacing. */
export function plainText(content: unknown): string {
  if (!content) return ''
  if (Array.isArray(content)) return content.map(plainText).join(' ')
  if (typeof content === 'string') return content
  if (typeof content !== 'object') return ''

  const node = content as { _type?: string; children?: unknown; rows?: unknown; text?: unknown }
  if (node._type === 'block' && Array.isArray(node.children)) {
    return node.children
      .map((child: { _type?: string; text?: string }) =>
        child?._type === 'span' ? child.text || '' : plainText(child)
      )
      .join(' ')
  }
  if (node._type === 'table' && Array.isArray(node.rows)) {
    return node.rows
      .map((row: { cells?: { content?: unknown }[] }) =>
        Array.isArray(row?.cells) ? row.cells.map((cell) => plainText(cell?.content)).join(' ') : ''
      )
      .join(' ')
  }
  return ''
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function blocks(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length ? value : undefined
}

function slugOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return text((value as { current?: unknown }).current)
  return ''
}

export function reviewView(doc: SanityReviewDocument): ReviewView | null {
  if (!isContentReviewDocumentType(doc._type)) return null
  const base = {
    id: doc._id,
    rev: doc._rev,
    type: doc._type,
    updatedAt: doc._updatedAt ?? null,
  }

  switch (doc._type) {
    case 'resources': {
      const slug = slugOf(doc.slug)
      return {
        ...base,
        title: text(doc.title),
        metaDescription: truncate(plainText(doc.content), 150),
        publicPath: `/resources/${slug}`,
        byline: text(doc.author) || null,
        subtitle: null,
        sections: [{ heading: null, blocks: blocks(doc.content) }],
      }
    }
    case 'askUsAnything': {
      const question = text(doc.question)
      return {
        ...base,
        title: question,
        metaDescription: truncate(question, 160),
        publicPath: `/ask-us-anything/${slugOf(doc.slug)}`,
        byline: null,
        subtitle: null,
        sections: [{ heading: 'Answer', blocks: blocks(doc.answer) }],
      }
    }
    case 'featuredTreatments': {
      const benefits = Array.isArray(doc.benefits)
        ? doc.benefits.filter((b): b is string => typeof b === 'string')
        : []
      const sections: ReviewSection[] = [{ heading: null, blocks: blocks(doc.productDescription) }]
      if (benefits.length) sections.push({ heading: 'Benefits', items: benefits })
      if (blocks(doc.dosage)) sections.push({ heading: 'Dosage', blocks: blocks(doc.dosage) })
      if (blocks(doc.sideEffects)) {
        sections.push({ heading: 'Side effects', blocks: blocks(doc.sideEffects) })
      }
      return {
        ...base,
        title: text(doc.heroTitle),
        metaDescription:
          text(doc.blurb) || truncate(plainText(doc.productDescription), 200),
        publicPath: `/featured-treatments/${slugOf(doc.slug)}`,
        byline: null,
        subtitle: text(doc.heroSubtitle) || null,
        sections,
      }
    }
  }
}
