import { Fragment } from 'react'
import type { Block, Inline } from '@/lib/labReviews/summaryMarkdown'

/**
 * Renders the parsed `patient_summary` block tree.
 *
 * Note there is no `dangerouslySetInnerHTML` here and no HTML string anywhere
 * in the path: the summaries are model-generated, so they are parsed into a
 * closed set of blocks and rendered as real elements.
 */

function InlineRuns({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <Fragment key={i}>
          {run.bold ? <strong className="font-semibold text-foreground">{run.text}</strong> : run.text}
        </Fragment>
      ))}
    </>
  )
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-sm font-semibold tracking-tight text-foreground',
  2: 'text-sm font-semibold tracking-tight text-foreground',
  3: 'text-[13px] font-semibold text-foreground',
}

export function SummaryBlocks({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) {
    return <p className="text-sm text-muted-foreground">No summary was generated.</p>
  }

  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return (
            <h3 key={i} className={HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}>
              <InlineRuns runs={block.content} />
            </h3>
          )
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag
              key={i}
              className={
                block.ordered
                  ? 'list-decimal space-y-1 pl-5 marker:text-muted-foreground'
                  : 'list-disc space-y-1 pl-5 marker:text-muted-foreground'
              }
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <InlineRuns runs={item} />
                </li>
              ))}
            </ListTag>
          )
        }

        return (
          <p key={i}>
            <InlineRuns runs={block.content} />
          </p>
        )
      })}
    </div>
  )
}
