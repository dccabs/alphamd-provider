import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { mergeFlagNote, renderFlagNoteSection, type FlagNoteSection } from './flagNotes'

/**
 * Add one flag to a patient, idempotently.
 *
 * Mirrors the main app's `addFlagsToPatient`: `(patient_id, flag_id)` is unique,
 * and an inactive row may already exist, so a failed insert is retried as a
 * reactivating update rather than treated as an error. `last_updated_by` is NOT
 * NULL in this table and has no default.
 *
 * Its own module because three unrelated paths raise flags now — finishing a
 * review, escalating one, and sending a protocol — and the third arrived by way of
 * a copy of this function, which is how two versions of "is this flag already on"
 * start to disagree.
 *
 * With a `note`, the flag's description gains that section: merged into the note
 * of a flag that is already on, and the whole note of one that was off (whatever
 * it said then was already dealt with). Without one, the description is left as
 * it was.
 *
 * Returns whether it worked. Callers report a failure rather than throwing: a flag
 * is how work becomes visible elsewhere, not the work itself, and nothing that
 * calls this can be undone by the time it runs.
 */
export async function addPatientFlag(
  patientId: string,
  flagId: number,
  staffUserId: string,
  note?: FlagNoteSection
): Promise<boolean> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('user_flags_join')
    .select('id, active, description')
    .eq('patient_id', patientId)
    .eq('flag_id', flagId)
    .maybeSingle()

  if (existing?.active) {
    if (!note) return true
    const { error } = await admin
      .from('user_flags_join')
      .update({
        description: mergeFlagNote(existing.description as string | null, note),
        last_updated_by: staffUserId,
        last_updated: new Date().toISOString(),
      })
      .eq('id', existing.id)
    return !error
  }

  if (existing) {
    const { error } = await admin
      .from('user_flags_join')
      .update({
        active: true,
        last_updated_by: staffUserId,
        ...(note ? { description: renderFlagNoteSection(note) } : {}),
      })
      .eq('id', existing.id)
    return !error
  }

  const { error } = await admin.from('user_flags_join').insert({
    patient_id: patientId,
    flag_id: flagId,
    active: true,
    last_updated_by: staffUserId,
    ...(note ? { description: renderFlagNoteSection(note) } : {}),
  })
  return !error
}
