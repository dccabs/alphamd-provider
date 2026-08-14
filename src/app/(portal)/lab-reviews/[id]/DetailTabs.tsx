'use client'

import { useActionState, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CornerDownLeft, EyeOff, Paperclip, Send } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import {
  DEFAULT_REPLY_IDENTITY,
  REPLY_IDENTITIES,
  REPLY_IDENTITY_LABELS,
  type ReplyIdentity,
} from '@/lib/labReviews/replyIdentity'
import { sendCsReplyAction, type ReplyState } from '../actions'
import { AssistButton } from './AssistButton'
import type {
  CsInbox,
  CsMessage,
  CsThread,
  LabReviewEvent,
  LabReviewNote,
  PatientFile,
} from './types'

/**
 * Medications, orders and consultations used to be tabs here. They now live in
 * the patient header, where the clinical picture is read before the labs rather
 * than hunted for — see `PatientSnapshot`.
 */
type TabId = 'ai' | 'notes' | 'files' | 'messages' | 'activity'

const TAB_TITLES: Record<TabId, string> = {
  ai: 'AI Summary',
  notes: 'Notes',
  files: 'Patient files',
  messages: 'Message threads',
  activity: 'Review history',
}

export function DetailTabs({
  reviewId,
  notes,
  summaryBlocks,
  summaryGeneratedAt,
  files,
  cs,
  events,
  reviewNotes,
  shownFileId,
  onShowFile,
}: {
  /** Carried down to the reply composer, whose AI assist resolves the patient
   *  from the review rather than being handed a patient id. */
  reviewId: string
  notes: Note[]
  summaryBlocks: Block[]
  summaryGeneratedAt: string | null
  files: PatientFile[]
  cs: CsInbox
  events: LabReviewEvent[]
  reviewNotes: LabReviewNote[]
  shownFileId: number | null
  onShowFile: (file: PatientFile) => void
}) {
  const [tab, setTab] = useState<TabId>('ai')
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('provider')

  const visibleNotes = useMemo(() => filterNotes(notes, noteFilter), [notes, noteFilter])

  // Badge counts come from the data, not from a prop the design hardcoded. Each
  // one is how many items the tab holds, so the strip says what is in the record
  // at a glance. Notes follows the All/Provider filter rather than being pinned
  // to the provider count, so the badge always matches what is on screen.
  const tabs: { id: TabId; label: string; badge?: number; urgent?: boolean }[] = [
    { id: 'ai', label: 'AI' },
    { id: 'notes', label: 'Notes', badge: visibleNotes.length },
    { id: 'files', label: 'Files', badge: files.length },
    // Threads, not messages: the count is how many conversations are open. Unread
    // patient replies still turn it red, which is the part that needs answering.
    { id: 'messages', label: 'Messages', badge: cs.threads.length, urgent: cs.unreadCount > 0 },
    { id: 'activity', label: 'History' },
  ]

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card xl:absolute xl:inset-0">
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

      <div className="h-[632px] overflow-y-auto xl:h-auto xl:min-h-0 xl:flex-1">
        {tab === 'ai' && (
          <AiTab blocks={summaryBlocks} generatedAt={summaryGeneratedAt} />
        )}
        {tab === 'notes' && <NotesList notes={visibleNotes} filter={noteFilter} />}
        {tab === 'files' && (
          <FilesList files={files} shownFileId={shownFileId} onShowFile={onShowFile} />
        )}
        {tab === 'messages' && <MessagesList reviewId={reviewId} inbox={cs} />}
        {tab === 'activity' && <ActivityList events={events} reviewNotes={reviewNotes} />}
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
              <div className="truncate text-[13px] font-semibold">{file.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {[file.kindLabel, shortDate(file.createdAt), file.description]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {/* The badge takes the button's place rather than sitting beside the
                file name, so selecting a file does not reflow the row it is in. */}
            <div className="flex w-14 shrink-0 justify-end">
              {shown ? (
                <span className="rounded border border-green-200 bg-green-50 px-1.5 py-px text-[10px] font-bold tracking-wider text-green-700">
                  SHOWN
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => onShowFile(file)}>
                  View
                </Button>
              )}
            </div>
          </div>
        )
      })}
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Viewing a file loads it into the main viewer for quick past-lab comparison.
      </p>
    </div>
  )
}

/**
 * The audit trail for this review, newest first, with the handoff notes above it.
 *
 * The notes lead because they are the part somebody picking up a parked review
 * actually needs to read; the trail below is what they consult once they want to
 * know how it got here. `summary` is written at the time of each change, so the
 * trail reads as history rather than as a re-derivation of the current state.
 */
function ActivityList({
  events,
  reviewNotes,
}: {
  events: LabReviewEvent[]
  reviewNotes: LabReviewNote[]
}) {
  if (!events.length && !reviewNotes.length) {
    return (
      <EmptyState>
        Nothing has happened to this review yet. Starting it is the first entry.
      </EmptyState>
    )
  }

  return (
    <>
      {reviewNotes.length > 0 && (
        <ul className="flex flex-col border-b bg-amber-50/40">
          {reviewNotes.map((note) => (
            <li key={note.id} className="flex flex-col gap-1 border-b border-amber-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded border border-amber-200 bg-amber-100 px-1.5 py-px text-[9.5px] font-bold tracking-wider text-amber-900">
                  {note.kind.replace(/_/g, ' ').toUpperCase()}
                </span>
                {note.aiAssisted && <Badge variant="secondary">AI assisted</Badge>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {shortDateTime(note.createdAt)}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{note.note}</p>
              {note.authorName && (
                <span className="text-xs text-muted-foreground">{note.authorName}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col">
        {events.map((event) => (
          <li key={event.id} className="flex flex-col gap-1 border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="rounded border border-border bg-muted px-1.5 py-px text-[9.5px] font-bold tracking-wider text-muted-foreground">
                {event.eventType.replace(/_/g, ' ').toUpperCase()}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {shortDateTime(event.createdAt)}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed">
              {event.summary ?? 'No description recorded.'}
            </p>
            {event.actorName && (
              <span className="text-xs text-muted-foreground">
                {event.actorName}
                {event.actorRole ? ` · ${event.actorRole}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
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

const MESSAGE_ROLE_STYLE: Record<CsMessage['role'], string> = {
  PROVIDER: 'border-blue-200 bg-blue-50 text-blue-700',
  STAFF: 'border-border bg-muted text-muted-foreground',
  PATIENT: 'border-border bg-muted text-muted-foreground',
}

function MessagesList({ reviewId, inbox }: { reviewId: string; inbox: CsInbox }) {
  if (!inbox.threads.length) return <EmptyState>No messages for this patient.</EmptyState>

  return (
    <ul className="flex flex-col">
      {inbox.threads.map((thread, i) => (
        // The newest thread is the one a provider almost always answers, so its
        // composer is open on arrival and the rest are one click away.
        <MessageThread
          key={thread.ticketId}
          reviewId={reviewId}
          thread={thread}
          defaultComposing={i === 0}
        />
      ))}
    </ul>
  )
}

function MessageThread({
  reviewId,
  thread,
  defaultComposing,
}: {
  reviewId: string
  thread: CsThread
  defaultComposing: boolean
}) {
  const [state, formAction] = useActionState(sendCsReplyAction, INITIAL_REPLY)
  const [composing, setComposing] = useState(defaultComposing)
  const [sendAs, setSendAs] = useState<ReplyIdentity>(DEFAULT_REPLY_IDENTITY)
  const [body, setBody] = useState('')
  const [handled, setHandled] = useState<ReplyState>(INITIAL_REPLY)

  // Emptying the box once a send succeeds — what the `key` remount did while the
  // field was uncontrolled. Adjusted during render rather than in an effect so
  // the cleared box is never painted with the old text still in it. `state` is a
  // fresh object per action result, so this runs once per send and does not wipe
  // anything typed afterwards.
  if (state !== handled) {
    setHandled(state)
    if (state.status === 'sent') setBody('')
  }

  // The mirror table is written by a webhook Zendesk fires at alphamd, which
  // this app does not own, so a sent reply does not appear in `messages` for a
  // while. Show it optimistically instead of looking like the send failed.
  const optimistic = state.status === 'sent' && state.sentBody ? state.sentBody : null

  return (
    <li className="border-b">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="text-[13px] font-semibold">{thread.subject}</span>
        {thread.unreadCount > 0 && <Badge variant="destructive">{thread.unreadCount} new</Badge>}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {shortDate(thread.lastActivityAt)}
        </span>
      </div>

      <div className="flex flex-col">
        {thread.messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}

        {optimistic && (
          <div className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold">You</span>
              <span
                className={`rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${MESSAGE_ROLE_STYLE.PROVIDER}`}
              >
                PROVIDER
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {state.sentAs
                  ? `Sent ${REPLY_IDENTITY_LABELS[state.sentAs]} · syncing`
                  : 'Sent · syncing'}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {optimistic}
            </p>
          </div>
        )}
      </div>

      {state.status === 'error' && (
        <p role="alert" className="bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {state.message}
        </p>
      )}
      {state.warning && (
        <p role="alert" className="bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {state.warning}
        </p>
      )}

      {composing ? (
        <form action={formAction} className="flex flex-col gap-2 px-4 py-3">
          <input type="hidden" name="ticketId" value={thread.ticketId} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Send
            <select
              name="sendAs"
              value={sendAs}
              onChange={(e) => setSendAs(e.target.value as ReplyIdentity)}
              aria-label="Who this reply is sent as"
              className="h-7 rounded-lg border border-input bg-transparent px-2 py-0.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {REPLY_IDENTITIES.map((identity) => (
                <option key={identity} value={identity}>
                  {REPLY_IDENTITY_LABELS[identity]}
                </option>
              ))}
            </select>
          </label>
          <Textarea
            name="body"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Reply to this thread…"
            aria-label={`Reply to ${thread.subject}`}
          />
          <div className="flex items-start justify-between gap-2">
            {/* The identity is passed through: a reply signed by the provider and
                one signed by AlphaMD Support are written differently. */}
            <AssistButton
              reviewId={reviewId}
              task="cs_reply"
              value={body}
              onChange={setBody}
              identity={sendAs}
            />
            <SendButton />
          </div>
        </form>
      ) : (
        <div className="px-4 py-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setComposing(true)}>
            <CornerDownLeft />
            Reply
          </Button>
        </div>
      )}
    </li>
  )
}

function MessageRow({ message }: { message: CsMessage }) {
  return (
    <div
      className={[
        'flex flex-col gap-1.5 px-4 py-3',
        // 22% of mirrored comments are internal staff notes the patient never
        // saw. Letting them read as sent messages would be actively misleading
        // on a clinical screen.
        message.isPublic ? '' : 'bg-amber-50/50',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{message.author}</span>
        <span
          className={`rounded border px-1.5 py-px text-[9.5px] font-bold tracking-wider ${MESSAGE_ROLE_STYLE[message.role]}`}
        >
          {message.role}
        </span>
        {!message.isPublic && (
          <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[9.5px] font-bold tracking-wider text-amber-800">
            <EyeOff className="size-2.5" />
            INTERNAL — NOT SENT
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {shortDateTime(message.createdAt)}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {message.message}
      </p>

      {message.attachmentCount > 0 && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Paperclip className="size-3" />
          {message.attachmentCount} attachment{message.attachmentCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  )
}
