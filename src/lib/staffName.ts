/**
 * The name written onto a chart note and shown on the portal chrome.
 *
 * `user_list` is missing for a fresh staff account, so the email is the
 * fallback that keeps the person identifiable.
 */
export function staffDisplayName(
  person: { firstName?: string | null; lastName?: string | null } | null,
  email: string,
): string {
  const name = [person?.firstName, person?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  return name || email
}
