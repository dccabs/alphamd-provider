'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Stream the AI chart summary for a finish screen.
 *
 * Generated once, on open, from the structured `events` the plan composed —
 * never from the provider's prose, so the summary cannot invent a decision
 * that was not recorded. An existing summary (a reopened finish screen) is
 * kept rather than regenerated; the provider can ask for a fresh one.
 *
 * Shared by the Lab Review and Provider Question finish dialogs, which write
 * different notes from the same endpoint.
 */
export function useChartSummary({
  events,
  existing,
  enabled,
  onReady,
}: {
  events: string
  existing: string
  enabled: boolean
  onReady: (text: string) => void
}) {
  const [streaming, setStreaming] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  // The parent passes a fresh callback each render. Reading it through a ref
  // keeps the request from restarting on every keystroke.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const generate = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setStatus('generating')
    setStreaming('')
    setError(null)

    try {
      const response = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'chartSummary', events }),
        signal: controller.signal,
      })

      if (controller.signal.aborted) return

      if (!response.ok || !response.body) {
        const message = (await response.text().catch(() => '')) || 'The assistant failed.'
        setError(message)
        setStatus('error')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setStreaming(text)
      }

      if (controller.signal.aborted) return

      const next = text.trim()
      if (!next) {
        setError('The assistant returned nothing.')
        setStatus('error')
        return
      }

      onReadyRef.current(next)
      setStatus('idle')
    } catch (cause) {
      if (controller.signal.aborted) return
      console.error('[useChartSummary]', cause)
      setError('The assistant could not be reached.')
      setStatus('error')
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }, [events])

  useEffect(() => {
    if (!enabled || !events.trim() || existing.trim()) return
    void generate()
    // Dev mode runs this effect, cancels it, then runs it again. The cancel
    // must be allowed to start a fresh request, or the note stays on "Writing…".
    return () => abort.current?.abort()
  }, [enabled, events, existing, generate])

  return { status, streaming, error, generate }
}
