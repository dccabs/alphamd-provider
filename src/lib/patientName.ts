/**
 * What to call a patient in something written to them.
 *
 * `user_list.preferred_name` is a free-text box, and most patients type their
 * whole name into it: of the 3,870 rows that have one, 671 hold more than one
 * word, and most of those are exactly `first_name last_name`. A message opening
 * "Hi Rhom Saint-louis," is worse than one that uses no name at all, so the
 * surname comes back off here rather than in each place that writes to a patient.
 *
 * The preferred name still wins over the legal one, which is the whole point of
 * the field — "Tim Spangler" against a legal Timothy means Tim, and "AJ Lovewins"
 * against a legal `Charles "AJ"` means AJ.
 *
 * Only a trailing surname is removed, so a two-word given name survives ("Mary
 * Jane Smith" gives Mary Jane). When the name does not end in the surname on
 * file there is nothing to match against, and the first word is the only part
 * that is definitely not a surname.
 */
export function greetingName(patient: {
  preferredName?: string | null
  firstName?: string | null
  lastName?: string | null
}): string | null {
  const source = collapse(patient.preferredName) || collapse(patient.firstName)
  if (!source) return null

  const last = collapse(patient.lastName)
  if (last) {
    const suffix = ` ${last}`
    if (source.toLowerCase().endsWith(suffix.toLowerCase())) {
      const given = source.slice(0, -suffix.length).trim()
      if (given) return given
    }
  }

  return source.split(' ')[0] || source
}

/** Trimmed, with runs of whitespace closed up — "Francesco  Taormina" is on file
 *  exactly like that, and a double space would defeat matching the surname. */
function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}
