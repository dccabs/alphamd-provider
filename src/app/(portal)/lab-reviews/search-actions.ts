'use server'

import { checkProviderAccess } from '@/lib/authz'
import { searchPatientsForQueue } from '@/lib/labReviews/queries'
import type { PatientSuggestion } from '@/lib/labReviews/patientSearch'

/**
 * Typeahead for the queue picker. A server action because the query hits
 * `user_list` through the service-role client, which the browser must not
 * import. An expired session returns no suggestions rather than throwing, so
 * the combobox stays usable while the rest of the page is still on screen.
 */
export async function searchPatientsAction(query: string): Promise<PatientSuggestion[]> {
  const access = await checkProviderAccess()
  if (!access.ok) return []
  return searchPatientsForQueue(query)
}
