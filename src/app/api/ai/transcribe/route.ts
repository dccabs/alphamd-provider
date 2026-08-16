import { createHash } from 'node:crypto'

import { DICTATION_SESSION } from '@/lib/ai/dictation'
import { checkProviderAccess } from '@/lib/authz'

/**
 * Signs the handshake for a dictation session, and stays out of the way.
 *
 * The browser builds a WebRTC offer, posts the SDP here, and gets OpenAI's answer
 * back. From then on the audio flows from the microphone straight to OpenAI and
 * the transcript comes straight back — this route is not on that path and never
 * sees a second of it.
 *
 * Which is the reason for going through here at all: the alternative is an API
 * key in the browser. This is the "unified interface" from OpenAI's WebRTC guide,
 * chosen over minting an ephemeral client secret because it also keeps the
 * session configuration server-side. A provider's browser cannot ask for a
 * different model, a different language, or a session that talks back.
 */

export const runtime = 'nodejs'
/** The handshake only. The session it opens outlives this request. */
export const maxDuration = 15

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export async function POST(request: Request) {
  const access = await checkProviderAccess()
  if (!access.ok) {
    return new Response('Your session has expired. Reload the page and sign in again.', {
      status: 401,
    })
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response('Dictation is not configured in this environment.', { status: 503 })
  }

  const offer = await request.text()
  // A real offer is a multi-line SDP blob. Anything this short is a bug on our
  // side, not something to spend an OpenAI round trip finding out about.
  if (!offer.startsWith('v=')) {
    return new Response('Malformed offer.', { status: 400 })
  }

  const form = new FormData()
  form.set('sdp', offer)
  form.set('session', JSON.stringify(DICTATION_SESSION))

  let answer: Response
  try {
    answer = await fetch(CALLS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        // Hashed rather than the raw id: it identifies one provider to OpenAI's
        // abuse tooling consistently without telling them who that is. Set here
        // because the browser must not be trusted to set it.
        'OpenAI-Safety-Identifier': createHash('sha256').update(access.access.userId).digest('hex'),
      },
      body: form,
    })
  } catch (error) {
    console.error('realtime handshake failed', error)
    return new Response('Could not reach the transcriber. Try again.', { status: 503 })
  }

  if (!answer.ok) {
    // The body is OpenAI's JSON error. Logged whole because a failure here is a
    // configuration problem — a retired model, a session field that changed —
    // and the provider can do nothing with the detail.
    console.error('realtime handshake rejected', answer.status, await answer.text())
    return new Response('The transcriber turned down the connection.', { status: 503 })
  }

  return new Response(await answer.text(), {
    headers: { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' },
  })
}
