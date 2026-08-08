/**
 * A deliberately small Markdown parser for `lab_review_reports.patient_summary`.
 *
 * The stored summaries are Markdown, not plain text — measured across all 1,050
 * production rows: 1,046 use `#` headings, 1,048 use `**bold**`, 993 use `-`
 * bullets and 106 use numbered lists. None contain tables, fenced code, links
 * or raw HTML. Rendering the text as-is would show literal `#` and `**` on a
 * clinical screen.
 *
 * This parses to a small block tree that a React component renders as real
 * elements. It never produces HTML, so there is no `dangerouslySetInnerHTML`
 * anywhere near model-generated text. Constructs it does not know (tables, for
 * instance) degrade to plain paragraph text rather than disappearing.
 */

export type Inline = { text: string; bold: boolean }

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/

/** Split on `**bold**`. Unmatched `**` is left as literal text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  // No `s` flag: paragraphs are joined into a single line before this runs, and
  // the flag would need an ES2018 target.
  const parts = text.split(/\*\*(.+?)\*\*/)
  parts.forEach((part, i) => {
    if (!part) return
    out.push({ text: part, bold: i % 2 === 1 })
  })
  return out.length ? out : [{ text: '', bold: false }]
}

export function parseSummary(markdown: string | null | undefined): Block[] {
  if (!markdown?.trim()) return []

  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      items: list.items.map(parseInline),
    })
    list = null
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
  }

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()

    if (!line.trim()) {
      flushAll()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushAll()
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        content: parseInline(heading[2].trim()),
      })
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      flushParagraph()
      if (!list?.ordered) {
        flushList()
        list = { ordered: true, items: [] }
      }
      list.items.push(ordered[1].trim())
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      flushParagraph()
      if (!list || list.ordered) {
        flushList()
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1].trim())
      continue
    }

    flushList()
    paragraph.push(line.trim())
  }

  flushAll()
  return blocks
}

/** Plain-text flattening, for previews and `title` attributes. */
export function summaryToPlainText(markdown: string | null | undefined): string {
  return parseSummary(markdown)
    .map((block) => {
      if (block.type === 'list') {
        return block.items.map((i) => i.map((s) => s.text).join('')).join(' ')
      }
      return block.content.map((s) => s.text).join('')
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
