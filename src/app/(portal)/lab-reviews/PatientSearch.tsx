'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PATIENT_SEARCH_MIN_CHARS,
  suggestionSubtitle,
  type PatientSuggestion,
  type QueuePatient,
} from '@/lib/labReviews/patientSearch'
import { searchPatientsAction } from './search-actions'

const DEBOUNCE_MS = 200

/**
 * Combobox that picks a patient for the queue page.
 *
 * Typing searches `user_list`. Choosing a row sets `?patient=` so the page
 * can list that person's reviews. The typed text is not in the URL — only the
 * selected id is shareable. The parent remounts this on `selected.patientId`
 * so the input starts as that person's name without syncing props into state.
 */
export function PatientSearch({ selected }: { selected: QueuePatient | null }) {
  const router = useRouter()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)

  const [query, setQuery] = useState(selected?.name ?? '')
  const [suggestions, setSuggestions] = useState<PatientSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)

  const canSearch = useMemo(() => {
    const trimmed = query.trim()
    return trimmed.length >= PATIENT_SEARCH_MIN_CHARS && trimmed !== selected?.name
  }, [query, selected?.name])

  useEffect(() => {
    if (!canSearch) return

    const handle = window.setTimeout(() => {
      const id = ++requestId.current
      setLoading(true)
      void searchPatientsAction(query).then((rows) => {
        if (id !== requestId.current) return
        setSuggestions(rows)
        setActiveIndex(0)
        setOpen(true)
        setLoading(false)
      })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(handle)
      requestId.current += 1
    }
  }, [query, canSearch])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function selectPatient(patientId: string) {
    setOpen(false)
    router.push(`/lab-reviews?patient=${encodeURIComponent(patientId)}`)
  }

  function clear() {
    setQuery('')
    setSuggestions([])
    setOpen(false)
    if (selected) router.push('/lab-reviews')
  }

  const showList = open && canSearch
  const showClear = query.length > 0 || selected !== null
  const rows = canSearch ? suggestions : []

  return (
    <div ref={rootRef} className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${activeIndex}` : undefined}
        aria-label="Search patients by name or email"
        placeholder="Search patients by name or email"
        value={query}
        autoComplete="off"
        className="pl-8 pr-8"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          if (canSearch && suggestions.length) setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            return
          }
          if (!showList || rows.length === 0) {
            if (event.key === 'Enter') event.preventDefault()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((i) => (i + 1) % rows.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((i) => (i - 1 + rows.length) % rows.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const row = rows[activeIndex]
            if (row) selectPatient(row.patientId)
          }
        }}
      />
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear patient"
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
          onClick={clear}
        >
          <X />
        </Button>
      )}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-xl border bg-card py-1 shadow-md"
        >
          {loading && rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>
          ) : rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching patients.</li>
          ) : (
            rows.map((row, index) => (
              <li key={row.patientId} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? 'flex w-full flex-col items-start gap-0.5 bg-muted px-3 py-2 text-left'
                      : 'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/60'
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectPatient(row.patientId)}
                >
                  <span className="text-sm font-medium">{row.name}</span>
                  {row.email && (
                    <span className="text-xs text-muted-foreground">{row.email}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{suggestionSubtitle(row)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
