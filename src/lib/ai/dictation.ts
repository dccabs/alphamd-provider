/**
 * Speech into a textarea: the session OpenAI is asked for, and what to do with
 * the events it sends back.
 *
 * Pure on purpose. The browser half — a microphone, a peer connection, a data
 * channel — cannot be tested, so everything that decides what text a provider
 * ends up with lives here instead, and `useDictation` is left with nothing but
 * plumbing.
 */

/** The model that streams text while somebody is still talking. */
export const DICTATION_MODEL = 'gpt-live-transcribe'

/**
 * Words this model would otherwise have to guess at. Hints, not a vocabulary:
 * the model is free to ignore them, and a term that is not listed still comes
 * out right most of the time.
 *
 * Deliberately short and drug-heavy. A misheard dose is the error that matters
 * here, and every entry costs prompt space — so this is the vocabulary of the
 * fields being dictated into, not a formulary.
 */
export const DICTATION_KEYWORDS = [
  'testosterone cypionate',
  'testosterone enanthate',
  'anastrozole',
  'enclomiphene',
  'tadalafil',
  'estradiol',
  'hematocrit',
  'hemoglobin',
  'PSA',
  'total testosterone',
  'free testosterone',
  'subcutaneously',
  'intramuscular',
  'milligrams per week',
]

/**
 * What the session is for, in the model's own terms.
 *
 * `turn_detection` is null because it has to be: `gpt-live-transcribe` refuses a
 * session that asks for it ("Turn detection is not supported for this
 * transcription model"). So nothing segments the speech automatically — the
 * audio is one turn until the client commits it, which is what `stop()` does.
 *
 * `delay: 'low'` buys earlier partial text at some cost to accuracy. That is the
 * right trade for dictation specifically: the provider is watching the words
 * appear and is the one who corrects them, so text arriving late is a worse
 * failure than text arriving imperfect.
 */
export const DICTATION_SESSION = {
  type: 'transcription',
  audio: {
    input: {
      transcription: {
        model: DICTATION_MODEL,
        delay: 'low',
        languages: ['en'],
        prompt:
          'A physician dictating into a hormone clinic chart: lab results, dose ' +
          'changes, instructions for staff, and messages to patients.',
        keywords: DICTATION_KEYWORDS,
      },
      turn_detection: null,
    },
  },
} as const

/**
 * What has been said so far, split by how much it can still be trusted.
 *
 * `partial` is what the model has heard but not finished with, and it revises
 * itself — the guide is explicit that a later delta can correct an earlier one.
 * `committed` is what came back in a `completed` event, which is the model's
 * final answer for a turn and never changes again.
 *
 * They are kept apart rather than concatenated as they arrive because the
 * authoritative transcript replaces the guess wholesale, and that is only
 * possible if the guess is still identifiable.
 */
export type DictationState = { committed: string; partial: string }

export const NO_SPEECH: DictationState = { committed: '', partial: '' }

/**
 * Fold one server event into the transcript.
 *
 * Anything unrecognised leaves the state alone. The realtime API sends a good
 * deal more than transcript events, and a new one appearing in a later API
 * version must not be able to change a word of somebody's note.
 */
export function applyRealtimeEvent(state: DictationState, event: unknown): DictationState {
  if (!isRecord(event)) return state

  switch (event.type) {
    case 'conversation.item.input_audio_transcription.delta': {
      const delta = typeof event.delta === 'string' ? event.delta : ''
      return delta ? { ...state, partial: state.partial + delta } : state
    }

    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : ''
      // An empty final transcript means the audio held no speech, so the guess
      // it replaces goes too — better to lose a hallucinated fragment than to
      // keep it after the model has said there was nothing there.
      return { committed: join(state.committed, transcript), partial: '' }
    }

    default:
      return state
  }
}

/**
 * Whether this event is the model's last word on the audio it was given.
 *
 * With turn detection off there is one of these per commit, and it arrives after
 * the commit — so it is also the signal that a session being stopped has nothing
 * further to wait for.
 */
export function isFinalTranscript(event: unknown): boolean {
  return (
    isRecord(event) && event.type === 'conversation.item.input_audio_transcription.completed'
  )
}

/** Everything heard, ready to read. */
export function spokenText({ committed, partial }: DictationState): string {
  return join(committed, partial)
}

/**
 * The field's new contents: what was already typed, with the dictation dropped in
 * where the cursor was.
 *
 * Spacing is the whole job. Speech arrives with no idea what it is landing next
 * to, so dictating into the middle of a sentence would otherwise jam two words
 * together, and dictating at the end of one would run on from the full stop.
 */
export function transcriptAt(before: string, after: string, state: DictationState): string {
  // Trimmed because the model's own spacing cannot be trusted at the edges: the
  // first delta of a turn arrives with a leading space, and a delta mid-sentence
  // often ends with one. Both would show up as a gap in the field.
  const spoken = spokenText(state).trim()
  if (!spoken) return before + after

  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const tail = after && !/^\s/.test(after) ? ' ' : ''

  return `${before}${lead}${spoken}${tail}${after}`
}

/**
 * The message behind an `error` event, if that is what this is.
 *
 * Parsed here rather than in the hook so the hook never reads the wire format.
 * The realtime API's own wording is used as-is: it says things like "audio
 * content is too long", which is more use to a provider than anything this
 * layer could invent.
 */
export function realtimeError(event: unknown): string | null {
  if (!isRecord(event) || event.type !== 'error') return null
  const error = isRecord(event.error) ? event.error : null
  const message = error && typeof error.message === 'string' ? error.message.trim() : ''

  return message || 'The transcriber stopped unexpectedly.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Two spoken fragments, one space, no empty gap when either side is missing. */
function join(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  return `${left} ${right}`
}
