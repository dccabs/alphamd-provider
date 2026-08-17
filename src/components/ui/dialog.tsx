"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * `forceRender` because Base UI drops the backdrop of a nested dialog, on the
 * assumption that the dialog it opened from already dimmed the page. Every dialog
 * in a lab review is nested inside the review sheet, and that sheet is the one
 * surface here with no backdrop by design — it has to leave the lab document
 * readable. Without this, a dialog opened from the sheet dims nothing at all.
 *
 * Two stacked backdrops would double the dim, so this holds only while the sheet
 * stays the sole dialog that hosts others.
 */
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      forceRender
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Where the dialog sits, and how it gets there. Position and animation are one
 * variant on purpose: a panel that slides in from an edge has to be anchored to
 * the edge it slides from, and splitting the two is how you end up with a sheet
 * that zooms.
 *
 * `slide-in-from-right` translates by a full 100%, so the panel travels its own
 * width. That works because the resting position comes from `top`/`right` rather
 * than a transform — the enter keyframe animates from the entering transform to
 * the element's own, so a panel with no transform lands flush against the edge.
 * `duration-200` overrides the shared 100ms, which is too quick to read as a
 * slide across a wide sheet.
 */
const SIDE_CLASSES: Record<"center" | "right", string> = {
  center:
    "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 sm:max-w-sm data-open:zoom-in-95 data-closed:zoom-out-95",
  right:
    "top-0 right-0 h-dvh rounded-none duration-200 data-open:slide-in-from-right data-closed:slide-out-to-right",
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  side = "center",
  showOverlay = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  side?: "center" | "right"
  /** Off for a sheet that has to leave the page behind it readable and clickable. */
  showOverlay?: boolean
}) {
  return (
    <DialogPortal>
      {showOverlay && <DialogOverlay />}
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // `grid-cols-[minmax(0,1fr)]` rather than the implicit `auto` track. An
          // auto track is sized by its content's minimum, so one unbreakable child
          // — a long comma-joined list, a wide table — grows the popup past its own
          // max-width instead of being clipped or wrapped inside it. Pinning the
          // column to the container makes the max-width mean what it says.
          "fixed z-50 grid w-full max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          SIDE_CLASSES[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
