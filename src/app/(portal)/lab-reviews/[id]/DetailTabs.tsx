'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { EyeOff, Paperclip, Send } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SummaryBlocks } from '@/components/summary-blocks'
import { shortDate, shortDateTime } from '@/lib/labReviews/format'
import {
  NOTE_FILTERS,
  NOTE_FILTER_LABELS,
  filterNotes,
  type Note,
  type NoteFilter,
} from '@/lib/labReviews/notes'
import type { Block } from '@/lib/labReviews/summaryMarkdown'
import { sendCsReplyAction, type ReplyState } from '../actions'
import type { CsThread, Medication, Order, PatientFile } from './types'

type TabId = 'notes' | 'ai' | 'meds' | 'orders' | 'files' | 'cs'

const TAB_TITLES: Record<TabId, string> = {
  notes: 'Notes',
  ai: 'AI Summary',
  meds: 'Medications',
  orders: 'Order history',
  files: 'Patient files',
  cs: 'Customer service thread',
}

export function DetailTabs({
  notes,
  summaryBlocks,
  summaryGeneratedAt,
  medications,
  orders,
  files,
  cs,
  shownFileId,
  onShowFile,
}: {
  notes: Note[]
  summaryBlocks: Block[]
  summaryGeneratedAt: string | null
  medications: Medication[]
  orders: Order[]
  files: PatientFile[]
  cs: CsThread
  shownFileId: number | null
  onShowFile: (file: PatientFile) => void
}) {
  const [tab, setTab] = useState<TabId>('notes')
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('provider')

  const visibleNotes = useMemo(() => filterNotes(notes, noteFilter), [notes, noteFilter])

  // Badge counts come from the data, not from a prop the design hardcoded.
  const tabs: { id: TabId; label: string; badge?: number; urgent?: boolean }[] = [
    { id: 'notes', label: 'Notes', badge: filterNotes(notes, 'provider').length },
    { id: 'ai', label: 'AI' },
    { id: 'meds', label: 'Meds' },
    { id: 'orders', label: 'Orders' },
    { id: 'files', label: 'Files' },
    { id: 'cs', label: 'CS', badge: cs.unreadCount, urgent: true },
  ]

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-stretch gap-1 overflow-x-auto border-b px-1.5">
        {tabs.map((t) => {
          const selected = t.id === tab
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={selected ? 'true' : undefined}
              className={[
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-2.5 text-xs font-medium',
                selected
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t.label}
              {!!t.badge && (
                <Badge variant={t.urgent && !selected ? 'destructive' : 'secondary'}>
                  {t.badge}
                </Badge>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        {tab === 'notes' ? (
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
            {NOTE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setNoteFilter(f)}
                className={[
                  'rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap',
                  noteFilter === f
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {NOTE_FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[13px] font-semibold">{TAB_TITLES[tab]}</span>
        )}
      </div>

      <div className="h-[632px] overflow-y-auto">
        {tab === 'notes' && <NotesList notes={visibleNotes} filter={noteFilter} />}
        {tab === 'ai' && (
          <AiTab blocks={summaryBlocks} generatedAt={summaryGeneratedAt} />
        )}
        {tab === 'meds' && <MedsList medications={medications} />}
        {tab === 'orders' && <OrdersList orders={orders} />}
        {tab === 'files' && (
          <FilesList files={files} shownFileId={shownFileId} onShowFile={onShowFile} />
        )}
        {tab === 'cs' && <CsTab thread={cs} />}
      </div>
    </section>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}

const NOTE_TAG_STYLE: Record<Note['tag'], string> = {
  PROVIDER: 'border-blue-200 bg-blue-50 text-blue-700',
  INTERNAL: 'border-amber-200 bg-amber-50 text-amber-800',
  STAFF: 'border-border bg-muted text-muted-foreground',
  PATIENT: 'border-border bg-muted text-muted-foreground',
  SYSTEM: 'border-border bg-muted text-muted-foreground',
}

function NotesList({ notes, filter }: { notes: Note[]; filter: NoteFilter }) {
  if (!notes.length) {
    return (
      <EmptyState>
        {filter === 'provider'
          ? 'No provider notes for this patient. Try “All”.'
          : 'No notes for this patient.'}
      </EmptyState>
    )
  }

  return (
    <ul className="flex flex-col">
      {notes.map((note) => (
        <li key={note.id} className="flex flex-col gap-1.5 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{note.author}</span>
            <span
              className={`rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${NOTE_TAG_STYLE[note.tag]}`}
            >
              {note.tag}
            </span>
            {note.isOfficialVisit && <Badge variant="secondary">Visit</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">
              {shortDate(note.createdAt)}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {note.note}
          </p>
        </li>
      ))}
    </ul>
  )
}

function AiTab({ blocks, generatedAt }: { blocks: Block[]; generatedAt: string | null }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">AI</Badge>
        <span className="text-xs text-muted-foreground">
          {generatedAt ? `Generated ${shortDate(generatedAt)} · from chart + labs` : 'Not generated'}
        </span>
      </div>
      <SummaryBlocks blocks={blocks} />
    </div>
  )
}

function MedsList({ medications }: { medications: Medication[] }) {
  if (!medications.length) return <EmptyState>No medications on record.</EmptyState>

  return (
    <ul className="flex flex-col">
      {medications.map((med) => (
        <li key={med.id} className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className={`text-[13px] font-semibold ${med.active ? '' : 'text-muted-foreground'}`}>
              {med.name}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {[med.dosage, med.pharmacy, med.startedAt ? `started ${shortDate(med.startedAt)}` : null]
                .filter(Boolean)
                .join(' · ') || 'No dosage recorded'}
            </div>
          </div>
          <Badge variant={med.active ? 'default' : 'secondary'}>
            {med.active ? 'Active' : 'Expired'}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function OrdersList({ orders }: { orders: Order[] }) {
  if (!orders.length) return <EmptyState>No orders on record.</EmptyState>

  return (
    <ul className="flex flex-col">
      {orders.map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              {order.orderNumber ? `Order ${order.orderNumber}` : 'Order'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {[
                order.orderDate ? shortDate(order.orderDate) : null,
                order.pharmacy,
                order.trackingNumber
                  ? `${order.shippingCarrier ?? 'Tracking'} ${order.trackingNumber}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          {order.status && <Badge variant="secondary">{order.status}</Badge>}
        </li>
      ))}
    </ul>
  )
}

function FilesList({
  files,
  shownFileId,
  onShowFile,
}: {
  files: PatientFile[]
  shownFileId: number | null
  onShowFile: (file: PatientFile) => void
}) {
  if (!files.length) return <EmptyState>No files uploaded for this patient.</EmptyState>

  return (
    <div className="flex flex-col">
      {files.map((file) => {
        const shown = file.id === shownFileId
        return (
          <div key={file.id} className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="truncate">{file.name}</span>
                {shown && (
                  <span className="shrink-0 rounded border border-green-200 bg-green-50 px-1.5 py-px text-[10px] font-bold tracking-wider text-green-700">
                    SHOWN
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[file.kindLabel, shortDate(file.createdAt), file.description]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {!shown && (
              <Button variant="outline" size="sm" onClick={() => onShowFile(file)}>
                View
              </Button>
            )}
          </div>
        )
      })}
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Viewing a file loads it into the main viewer for quick past-lab comparison.
      </p>
    </div>
  )
}

function SendButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="icon" disabled={pending} aria-label="Send reply">
      <Send />
    </Button>
  )
}

const INITIAL_REPLY: ReplyState = { status: 'idle' }

function CsTab({ thread }: { thread: CsThread }) {
  const [state, formAction] = useActionState(sendCsReplyAction, INITIAL_REPLY)

  // The mirror table is written by a webhook Zendesk fires at alphamd, which
  // this app does not own, so a sent reply does not appear in `comments` for a
  // while. Show it optimistically instead of looking like the send failed.
  const optimistic = state.status === 'sent' && state.sentBody ? state.sentBody : null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2 text-xs text-muted-foreground">
        {thread.ticketId ? (
          <>
            <span className="font-medium text-foreground">
              {thread.subject || `Ticket ${thread.ticketId}`}
            </span>
            {thread.totalTickets > 1 && (
              <> · most recent of {thread.totalTickets} threads</>
            )}
          </>
        ) : (
          'No Zendesk thread for this patient.'
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
        {thread.comments.length === 0 && !optimistic && (
          <EmptyState>No messages in this thread.</EmptyState>
        )}

        {thread.comments.map((comment) => (
          <div
            key={comment.id}
            className={comment.isStaff ? 'max-w-[85%] self-end' : 'max-w-[85%] self-start'}
          >
            <div
              className={[
                'rounded-xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap',
                !comment.isPublic
                  ? // 22% of mirrored comments are internal staff notes the
                    // patient never saw. Making them look like sent messages
                    // would be actively misleading on a clinical screen.
                    'border border-dashed border-amber-300 bg-amber-50 text-amber-900'
                  : comment.isStaff
                    ? 'bg-foreground text-background'
                    : 'bg-muted',
              ].join(' ')}
            >
              {!comment.isPublic && (
                <span className="mb-1 flex items-center gap-1 text-[10px] font-bold tracking-wider text-amber-700">
                  <EyeOff className="size-3" />
                  INTERNAL — NOT SENT TO PATIENT
                </span>
              )}
              {comment.message}
              {comment.attachmentCount > 0 && (
                <span className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
                  <Paperclip className="size-3" />
                  {comment.attachmentCount} attachment
                  {comment.attachmentCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div
              className={`mt-1 text-[11px] text-muted-foreground ${comment.isStaff ? 'text-right' : ''}`}
            >
              {comment.author} · {shortDateTime(comment.createdAt)}
            </div>
          </div>
        ))}

        {optimistic && (
          <div className="max-w-[85%] self-end">
            <div className="rounded-xl bg-foreground px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-background">
              {optimistic}
            </div>
            <div className="mt-1 text-right text-[11px] text-muted-foreground">
              Sent · syncing
            </div>
          </div>
        )}
      </div>

      {state.status === 'error' && (
        <p role="alert" className="border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {state.message}
        </p>
      )}
      {state.warning && (
        <p role="alert" className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {state.warning}
        </p>
      )}

      <form action={formAction} className="flex gap-2 border-t px-3.5 py-3">
        <input type="hidden" name="ticketId" value={thread.ticketId ?? ''} />
        <Input
          name="body"
          key={state.status === 'sent' ? `sent-${optimistic?.length}` : 'compose'}
          placeholder={thread.ticketId ? 'Message care team…' : 'No thread to reply to'}
          disabled={!thread.ticketId}
          aria-label="Reply to the patient"
        />
        <SendButton />
      </form>
    </div>
  )
}
