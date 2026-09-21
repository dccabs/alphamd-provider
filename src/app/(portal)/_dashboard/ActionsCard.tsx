import { ExternalLink } from 'lucide-react'

import type { MyAction } from '@/lib/actions/queries'
import { adminActionsUrl } from '@/lib/adminLinks'
import { relativeAge } from '@/lib/labReviews/format'

/**
 * Actions assigned to the provider. Every row opens the admin Actions board in
 * a new tab, because that is where Actions are worked.
 */
export function ActionsCard({ actions }: { actions: MyAction[] }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          My actions
          <span className="ml-1.5 text-muted-foreground tabular-nums">{actions.length}</span>
        </h2>
        <a
          href={adminActionsUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Actions board
          <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-3">
        {actions.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            No actions are assigned to you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {actions.map((a) => (
              <li key={a.id}>
                <a
                  href={adminActionsUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border bg-card px-3 py-2 hover:bg-muted/60"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    {a.priority !== 'Normal' && (
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${
                          a.priorityColorClass ?? 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {a.priority}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">{a.status}</span>
                  </span>
                  <span className="mt-1 block text-sm font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[a.patientName, relativeAge(a.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
