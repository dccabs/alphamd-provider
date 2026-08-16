'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  DICTATION_SESSION,
  NO_SPEECH,
  applyRealtimeEvent,
  isFinalTranscript,
  realtimeError,
  type DictationState,
} from '@/lib/ai/dictation'

/**
 * A microphone wired to OpenAI's realtime transcriber.
 *
 * Audio goes from the microphone to OpenAI directly over WebRTC; our server only
 * signs the handshake (see `/api/ai/transcribe`). Text comes back on the peer
 * connection's data channel while the provider is still speaking, and every
 * event is handed to `applyRealtimeEvent` — this file decides nothing about what
 * the words are, only when the microphone is on.
 *
 * Which is most of the work, because a microphone that stays on is the failure
 * that matters. It is metered by the minute, and it is a live microphone in a
 * room where patients are discussed. So there is exactly one `stop`, and
 * everything that should end a session calls it: the button, twenty seconds of
 * quiet, five minutes on the clock, the tab being hidden, the device being
 * unplugged, the component unmounting.
 */

export type DictationStatus = 'idle' | 'connecting' | 'listening' | 'stopping'

/** Why a session ended on its own, for a status line that explains itself. */
export type StopReason = 'silence' | 'cap' | null

/** Long enough to think mid-sentence, short enough to catch a walk away. */
const SILENCE_MS = 20_000
const MAX_MS = 5 * 60_000
/** Grace for the final transcript to come back after committing the audio. */
const FLUSH_MS = 1_500

export function useDictation({ onSpeech }: { onSpeech: (speech: DictationState) => void }) {
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [stopReason, setStopReason] = useState<StopReason>(null)
  const [seconds, setSeconds] = useState(0)
  // Read through `useSyncExternalStore` so the server and the first client render
  // agree on `false` and the button appears on hydration. Reading `navigator`
  // during render directly would be a hydration mismatch.
  const supported = useSyncExternalStore(subscribeNever, canDictate, notOnTheServer)

  const stream = useRef<MediaStream | null>(null)
  const peer = useRef<RTCPeerConnection | null>(null)
  const channel = useRef<RTCDataChannel | null>(null)
  const speech = useRef<DictationState>(NO_SPEECH)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The callback closes over the field's contents, so it is new on every
  // keystroke. Held in a ref so the data channel listener does not have to be
  // rebound mid-sentence.
  const emit = useRef(onSpeech)
  useEffect(() => {
    emit.current = onSpeech
  })

  /** Releases the microphone and forgets the connection. Safe to call twice. */
  const teardown = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
    if (silence.current) clearTimeout(silence.current)
    silence.current = null

    channel.current?.close()
    channel.current = null

    peer.current?.close()
    peer.current = null

    // Last, and unconditionally: this is what turns the recording indicator off.
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null

    setStatus('idle')
    setSeconds(0)
  }, [])

  const stop = useCallback(
    (reason: StopReason = null) => {
      if (!peer.current && !stream.current) return
      if (reason) setStopReason(reason)
      setStatus('stopping')

      const open = channel.current?.readyState === 'open'
      if (!open) {
        teardown()
        return
      }

      // Committing is what produces the authoritative transcript for everything
      // said since the session opened — with turn detection off, nothing else
      // ever finalises it. The tail is worth a second and a half of waiting.
      channel.current?.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      timers.current.push(setTimeout(teardown, FLUSH_MS))
    },
    [teardown]
  )

  // One live reference for the listeners below, which are bound once but must
  // always reach the current `stop`.
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  const start = useCallback(async () => {
    if (status !== 'idle') return

    setError(null)
    setStopReason(null)
    speech.current = NO_SPEECH
    setStatus('connecting')

    let microphone: MediaStream
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (cause) {
      // The browser's own error names are the only reliable way to tell a refusal
      // from a machine with no microphone, and the two need different advice.
      const name = cause instanceof DOMException ? cause.name : ''
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access is blocked. Allow it in your browser, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone found on this computer.'
            : 'Could not open the microphone.'
      )
      setStatus('idle')
      return
    }

    stream.current = microphone

    try {
      const pc = new RTCPeerConnection()
      peer.current = pc

      for (const track of microphone.getTracks()) {
        pc.addTrack(track, microphone)
        // Revoked permission, an unplugged headset, a browser reclaiming the
        // device: all arrive here, and none of them are worth keeping a dead
        // session open for.
        track.addEventListener('ended', () => stopRef.current())
      }

      const dc = pc.createDataChannel('oai-events')
      channel.current = dc

      dc.addEventListener('open', () => {
        // Configured again from the client because the transcription guide's own
        // flow is a `session.update`, and the fields the handshake does not echo
        // back — the keyword hints, the latency setting — are worth asserting
        // where we can see them take effect. Same constant either way.
        dc.send(JSON.stringify({ type: 'session.update', session: DICTATION_SESSION }))
        setStatus('listening')
      })

      dc.addEventListener('message', (event: MessageEvent<string>) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          return
        }

        const failure = realtimeError(parsed)
        if (failure) {
          setError(failure)
          stopRef.current()
          return
        }

        const next = applyRealtimeEvent(speech.current, parsed)
        if (next === speech.current) return

        speech.current = next
        emit.current(next)
        armSilence()

        // The final transcript for a committed buffer. Nothing more is coming, so
        // there is no reason to hold the connection open for the grace period.
        if (isFinalTranscript(parsed)) teardown()
      })

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'failed') {
          setError('The connection to the transcriber dropped.')
          stopRef.current()
        }
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const answer = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      })

      if (!answer.ok) {
        setError((await answer.text()) || 'Could not start dictation.')
        teardown()
        return
      }

      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })

      timers.current.push(setTimeout(() => stopRef.current('cap'), MAX_MS))
      armSilence()
    } catch (cause) {
      console.error('dictation failed to start', cause)
      setError('Could not start dictation.')
      teardown()
    }

    function armSilence() {
      if (silence.current) clearTimeout(silence.current)
      silence.current = setTimeout(() => stopRef.current('silence'), SILENCE_MS)
    }
  }, [status, teardown])

  // The elapsed clock, which exists so the provider can see the meter running.
  useEffect(() => {
    if (status !== 'listening') return
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000)
    return () => clearInterval(tick)
  }, [status])

  useEffect(() => {
    if (status === 'idle') return

    const hide = () => {
      if (document.visibilityState === 'hidden') stopRef.current()
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [status])

  // Unmount — a closed flyout, a navigation — must not leave the microphone on.
  useEffect(() => teardown, [teardown])

  return { status, error, seconds, stopReason, supported, start, stop }
}

/** Whether this browser can capture audio at all. A page served over plain HTTP
 *  cannot, which is worth checking rather than failing at the first click. */
function canDictate(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof RTCPeerConnection !== 'undefined' &&
    window.isSecureContext
  )
}

/** Nothing to subscribe to: the answer cannot change while the page is open. */
const subscribeNever = () => () => {}
const notOnTheServer = () => false
