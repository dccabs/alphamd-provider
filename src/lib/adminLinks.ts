/**
 * Links into the staff admin app (alphamd), for the things this portal does not
 * have a screen for yet: the patient chart, the Actions board, and the Google
 * Meet redirect that opens a consult under the provider's own Google account.
 *
 * Separate from `NEXT_PUBLIC_DEFAULT_URL`, which is the patient-facing site
 * that emails link to. Staff links and patient links should be free to diverge.
 */

const DEFAULT_ADMIN_URL = 'https://www.alphamd.net'

export function adminUrl(path: string, base = process.env.NEXT_PUBLIC_ADMIN_URL): string {
  const origin = (base || DEFAULT_ADMIN_URL).replace(/\/+$/, '')
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

export function adminPatientUrl(patientId: string): string {
  return adminUrl(`/admin/users/${encodeURIComponent(patientId)}`)
}

export function adminActionsUrl(): string {
  return adminUrl('/admin/actions')
}

export function adminAppointmentsUrl(): string {
  return adminUrl('/admin/appointments')
}

/**
 * Join a consult the way the admin appointments page does: through
 * `/api/meet-redirect`, which follows the Calendly location URL to the real
 * Meet URL and appends `authuser=<email>` so a provider signed into several
 * Google accounts lands in the right one. Falls back to the raw URL when there
 * is no email to pin.
 */
export function meetJoinUrl(joinUrl: string, providerEmail: string | null): string {
  if (!providerEmail) return joinUrl
  const params = new URLSearchParams({ calendly_url: joinUrl, email: providerEmail })
  return adminUrl(`/api/meet-redirect?${params.toString()}`)
}
