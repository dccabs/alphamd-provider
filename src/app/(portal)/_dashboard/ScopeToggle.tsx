'use client'

import { useState, type ReactNode } from 'react'

export type Scope = 'all' | 'mine'

/**
 * The All / Assigned to me switch above one work type on the dashboard.
 *
 * Both lists are rendered on the server and handed in as nodes; this only
 * decides which one is visible, so `QueueList` stays a server component and
 * the two lists cannot describe a row differently from the queue pages.
 */
export function ScopeToggle({
  header,
  counts,
  all,
  mine,
}: {
  /** Rendered on the same line as the switch, to its left. */
  header: ReactNode
  counts: { all: number; mine: number }
  all: ReactNode
  mine: ReactNode
}) {
  const [scope, setScope] = useState<Scope>('all')

  const pill = (value: Scope, label: string, count: number) => {
    const active = scope === value
    return (
      <button
        type="button"
        onClick={() => setScope(value)}
        aria-pressed={active}
        className={[
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors',
          active
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ].join(' ')}
      >
        {label}
        <span className={`tabular-nums ${active ? 'text-background/70' : 'text-muted-foreground/70'}`}>
          {count}
        </span>
      </button>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">{header}</div>
        <div
          className="inline-flex items-center gap-0.5 rounded-full border bg-card p-0.5"
          role="group"
          aria-label="Which rows to show"
        >
          {pill('all', 'All', counts.all)}
          {pill('mine', 'Assigned to me', counts.mine)}
        </div>
      </div>
      <div className="mt-3">{scope === 'all' ? all : mine}</div>
    </div>
  )
}
