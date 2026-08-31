'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { signOut } from '@/app/(portal)/actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePortalViewerName } from '@/components/portal-viewer'

const WORDMARK = 'AlphaMD Provider Portal'

export function PortalChrome({
  left,
  displayName: displayNameProp,
}: {
  left?: ReactNode
  /** When set, this is the name — used on a Lab Review so the bar matches the chart. */
  displayName?: string
}) {
  const fromContext = usePortalViewerName()
  const displayName = displayNameProp ?? fromContext
  if (!displayName) return null

  return (
    <header className="flex h-13 items-center justify-between gap-4 border-b bg-card px-6 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 text-[13px]">
        {left ?? (
          <Link href="/" className="truncate font-semibold hover:text-foreground">
            {WORDMARK}
          </Link>
        )}
      </div>
      <ProviderMenu name={displayName} />
    </header>
  )
}

function ProviderMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-1 rounded-md text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {name}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
