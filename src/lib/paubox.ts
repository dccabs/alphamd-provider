import 'server-only'

/**
 * HIPAA-compliant email, ported from the main app's `utils/paubox.ts`.
 *
 * Only the `html` + `text` path is ported. The main app also accepts a React
 * Email component and renders it, which would drag `@react-email/*` into this repo
 * for one message; the templates here are plain strings instead.
 *
 * **Every email from this app must go through Paubox**, not because of a lint rule
 * but because these messages name a patient and reference their care. Paubox is
 * what makes that transport compliant, and `allowNonTLS: false` is what makes
 * Paubox refuse to fall back to plaintext delivery.
 */

export type PauboxResult = { ok: true } | { ok: false; error: string }

export function pauboxConfigured(): boolean {
  return Boolean(process.env.PAUBOX_API_USERNAME && process.env.PAUBOX_API_KEY)
}

/** `AlphaMD <noreply@alphamd.org>` → `noreply@alphamd.org`, which is what the API
 *  wants in the `from` header. */
function bareAddress(address: string): string {
  return /<(.+?)>/.exec(address)?.[1] ?? address.trim()
}

export async function sendPauboxEmail(options: {
  from: string
  to: string
  subject: string
  /** Always provide this. Some clients will not render the HTML part, and a
   *  scheduling link that arrives in an empty message is a support ticket. */
  text: string
  html?: string
}): Promise<PauboxResult> {
  const apiUsername = process.env.PAUBOX_API_USERNAME
  const apiKey = process.env.PAUBOX_API_KEY

  if (!apiUsername || !apiKey) {
    return { ok: false, error: 'Email is not configured in this environment.' }
  }

  const body = {
    data: {
      message: {
        recipients: [options.to],
        headers: { subject: options.subject, from: bareAddress(options.from) },
        content: {
          'text/plain': options.text,
          ...(options.html
            ? { 'text/html': Buffer.from(options.html).toString('base64') }
            : {}),
        },
        allowNonTLS: false,
        forceSecureNotification: false,
      },
    },
  }

  let response: Response
  try {
    response = await fetch(`https://api.paubox.net/v1/${apiUsername}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Token token=${apiKey}` },
      body: JSON.stringify(body),
    })
  } catch (error) {
    console.error('[paubox] request failed:', error)
    return { ok: false, error: 'Could not reach the email service.' }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`[paubox] ${response.status}: ${detail}`)
    return { ok: false, error: 'The email service rejected the message.' }
  }

  return { ok: true }
}
