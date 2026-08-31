'use client'

import { createContext, useContext, type ReactNode } from 'react'

const PortalViewerContext = createContext<string | null>(null)

export function PortalViewerProvider({
  displayName,
  children,
}: {
  displayName: string | null
  children: ReactNode
}) {
  return <PortalViewerContext.Provider value={displayName}>{children}</PortalViewerContext.Provider>
}

export function usePortalViewerName(): string | null {
  return useContext(PortalViewerContext)
}
