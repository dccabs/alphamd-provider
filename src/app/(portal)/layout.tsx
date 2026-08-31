import { PortalViewerProvider } from '@/components/portal-viewer'
import { getPortalViewer } from '@/lib/portalViewer'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getPortalViewer()

  return (
    <PortalViewerProvider displayName={viewer?.displayName ?? null}>
      <div className="flex min-h-screen flex-col bg-muted">{children}</div>
    </PortalViewerProvider>
  )
}
