'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, FileText, Maximize2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { fileTypeName, isUnrenderableImage } from '@/lib/labReviews/files'
import type { PatientFile } from './types'

/**
 * The lab document viewer.
 *
 * The design assumes a paginated PDF, but only 85% of files in the lab bucket
 * are PDFs. This branches on the real file type:
 *
 *  - **PDF** — embedded, with page and zoom controls. Page navigation is driven
 *    through the PDF viewer's own `#page=` fragment; the total page count is not
 *    knowable without parsing the file, so the control is open-ended rather than
 *    claiming a total it does not have.
 *  - **Image** (jpg/jpeg/png/webp/gif, 14.7% of files) — zoom kept, page
 *    controls **hidden** rather than shown-and-disabled, because an image has no
 *    pages at all.
 *  - **HEIC/HEIF** (33 files) — not embedded. Chrome and Firefox cannot decode
 *    them, so an `<img>` renders as a broken icon with no explanation. An honest
 *    message plus a download is better. Safari *can* render them, which is
 *    exactly why this must not be tested only in Safari.
 *  - **Anything else** (docx/xlsx/tiff/dng/no extension, ~34 files) — download
 *    only.
 */

const MIN_ZOOM = 50
const MAX_ZOOM = 150
const ZOOM_STEP = 10

export function DocumentViewer(props: {
  file: PatientFile | null
  signedUrl: string | null
  error: string | null
}) {
  // Keyed on the file so a different document starts at page 1 and 100% zoom.
  // Remounting is the idiomatic reset — resetting inside an effect would cause
  // a cascading render.
  return <ViewerFrame key={props.file?.id ?? 'none'} {...props} />
}

function ViewerFrame({
  file,
  signedUrl,
  error,
}: {
  file: PatientFile | null
  signedUrl: string | null
  error: string | null
}) {
  const [zoom, setZoom] = useState(100)
  const [page, setPage] = useState(1)

  const kind = file?.kind ?? 'unsupported'
  const showPageControls = kind === 'pdf'
  const showZoom = kind === 'pdf' || kind === 'image'

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {file?.name ?? 'No lab document'}
          </span>
          {file && (
            <span className="shrink-0 text-xs text-muted-foreground">{file.kindLabel}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showPageControls && (
            <div className="flex h-7 items-center overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="flex h-full items-center px-2 text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="flex h-full items-center border-x px-2 text-xs font-medium tabular-nums">
                Page {page}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
                className="flex h-full items-center px-2 text-muted-foreground hover:bg-muted"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}

          {showZoom && (
            <div className="flex h-7 items-center overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                className="flex h-full items-center px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                −
              </button>
              <span className="flex h-full items-center border-x px-2 text-xs font-medium tabular-nums">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                className="flex h-full items-center px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                +
              </button>
            </div>
          )}

          {signedUrl && (
            <>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={signedUrl} target="_blank" rel="noopener noreferrer" />}>
                <Maximize2 />
                Fullscreen
              </Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={signedUrl} download />}>
                <Download />
                Download
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex h-[640px] items-start justify-center overflow-auto bg-zinc-700 p-6">
        <ViewerBody file={file} signedUrl={signedUrl} error={error} zoom={zoom} page={page} />
      </div>
    </section>
  )
}

function ViewerBody({
  file,
  signedUrl,
  error,
  zoom,
  page,
}: {
  file: PatientFile | null
  signedUrl: string | null
  error: string | null
  zoom: number
  page: number
}) {
  if (!file) {
    return <Fallback title="No lab document on this review" body="This review has no attached file yet." />
  }
  if (error || !signedUrl) {
    return (
      <Fallback
        title="Could not open this file"
        body={error ?? 'The signed link could not be created. Try reloading the page.'}
      />
    )
  }

  if (file.kind === 'pdf') {
    return (
      <iframe
        // `#page=` is re-read by the embedded viewer when the src changes, so
        // keying on it forces a reload to the requested page.
        key={`${file.id}-${page}`}
        src={`${signedUrl}#page=${page}&zoom=${zoom}`}
        title={file.name}
        className="h-full w-full max-w-4xl rounded-sm bg-white shadow-lg"
      />
    )
  }

  if (file.kind === 'image') {
    return (
      // A plain <img>: the URL is a short-lived signed Supabase link, which
      // next/image cannot optimise and would need remotePatterns for.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={signedUrl}
        alt={file.name}
        style={{ width: `${zoom}%` }}
        className="h-auto max-w-none rounded-sm bg-white shadow-lg"
      />
    )
  }

  return (
    <Fallback
      title="Preview not supported in this browser"
      body={
        isUnrenderableImage(file.path)
          ? `${fileTypeName(file.path)} images render only in Safari, so this one is not embedded. Download it to view.`
          : `${fileTypeName(file.path)} files cannot be shown inline. Download it to view.`
      }
      action={
        <Button size="sm" nativeButton={false} render={<a href={signedUrl} download />}>
          <Download />
          Download {file.name}
        </Button>
      }
    />
  )
}

function Fallback({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 rounded-lg bg-card p-6 text-center">
      <FileText className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  )
}
