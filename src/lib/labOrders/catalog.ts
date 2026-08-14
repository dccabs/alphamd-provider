/**
 * The orderable lab tests, diagnosis codes and protocol presets.
 *
 * Ported verbatim from the main app's `constants/labRequisitions.ts` and
 * `constants/scheduledLabPresets.ts`, including the CPT codes in the display
 * names. Copied rather than shared because the two apps are separate deployments
 * with no shared package — which means **this file and the main app's constants
 * can drift.** They are the same clinical catalogue and a change to one belongs in
 * both.
 *
 * The `code` values are what get stored in `scheduled_lab_requisitions.requests`
 * and are read back by the main app's cron and its patient-facing order page, so
 * they are an interface, not a local naming choice. Do not rename one.
 */

export type LabTest = {
  code: string
  name: string
}

export const LAB_TESTS: LabTest[] = [
  { code: 'cbc_85025', name: 'CBC (85025)' },
  { code: 'cortisol_82533', name: 'Cortisol (82533)' },
  {
    code: 'hemoglobin_hematocrit_85014_85018',
    name: 'Hemoglobin & Hematocrit (85014/85018)',
  },
  { code: 'bmp_80048', name: 'BMP (80048)' },
  { code: 'cmp_80053', name: 'CMP (80053)' },
  { code: 'estradiol_82670', name: 'Estradiol (82670)' },
  { code: 'testosterone_total_84403', name: 'Testosterone, Total (84403)' },
  { code: 'testosterone_free_84402', name: 'Testosterone, Free (84402)' },
  { code: 'shbg_84270', name: 'SHBG (84270)' },
  { code: 'psa_31348', name: 'PSA (31348)' },
  { code: 'prolactin_84146', name: 'Prolactin (84146)' },
  { code: 'tsh_35167', name: 'TSH (35167)' },
  { code: 'dht_82642', name: 'DHT (82642)' },
  { code: 'lipid_panel_80061', name: 'Lipid Panel (80061)' },
  { code: 'dhea_sulfate_82627', name: 'DHEA-Sulfate (82627)' },
  { code: 'luteinizing_hormone_lh_83002', name: 'Luteinizing Hormone (LH) (83002)' },
  { code: 'igf_1_84305', name: 'IGF-1 (84305)' },
  { code: 'fsh_028480', name: 'FSH (028480)' },
  { code: 'vitamin_d_82306', name: 'Vitamin D (82306)' },
  { code: 'triiodothyronine_t3_002188', name: 'Triiodothyronine (T3) (002188)' },
  { code: 'phlebotomy_therapeutic_99195', name: 'Phlebotomy, therapeutic (99195)' },
  { code: 'progesterone_84144', name: 'Progesterone (84144)' },
  { code: 'cystatin_c_82610', name: 'Cystatin C (82610)' },
  { code: 'ferritin_82728', name: 'Ferritin (82728)' },
]

export const DIAGNOSIS_CODES: LabTest[] = [
  { code: 'E29.1', name: 'E29.1: Testosterone Deficiency' },
  { code: 'E28.39', name: 'E28.39: Hypogonadism in Female' },
  { code: 'R71.8', name: 'R71.8: Other abnormality of red blood cells' },
  {
    code: 'D75.1',
    name: 'D75.1: Polycythemia or Erythrocytosis - secondary to Testosterone Replacement Therapy (TRT)',
  },
  { code: 'R79.89', name: 'R79.89: Elevated Serum Creatinine' },
]

export const TEST_NAMES: Record<string, string> = Object.fromEntries(
  [...LAB_TESTS, ...DIAGNOSIS_CODES].map((t) => [t.code, t.name])
)

/**
 * Therapeutic phlebotomy must be ordered on its own requisition: it is not
 * eligible for discounted labs and cannot be combined with other tests. The rule
 * is enforced in `validateOrder` rather than only hinted at in the UI, because it
 * is a billing constraint the lab enforces downstream — an order that breaks it
 * fails after the patient has already been told it was placed.
 */
export const PHLEBOTOMY_CODE = 'phlebotomy_therapeutic_99195'

/**
 * Discounted (comped) labs are unavailable in New York and New Jersey.
 *
 * Both the abbreviation and the full name are matched because `user_list.state`
 * holds both spellings.
 */
const RESTRICTED_STATES = ['NY', 'NJ', 'NEW YORK', 'NEW JERSEY']

export function isRestrictedState(state: string | null | undefined): boolean {
  return RESTRICTED_STATES.includes((state ?? '').trim().toUpperCase())
}

export type LabPreset = {
  id: string
  label: string
  description: string
  testCodes: string[]
  diagnosisCodes: string[]
  /** Tests the patient may not remove on the order page. */
  requiredCodes?: string[]
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: 'bare_minimum_initial',
    label: 'Bare Minimum Initial',
    description: 'Total Testosterone only — required, cannot be removed by patient',
    testCodes: ['testosterone_total_84403'],
    requiredCodes: ['testosterone_total_84403'],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'initial_bare_min',
    label: 'Standard Initial',
    description: 'Core hormone panel for initial evaluation',
    testCodes: [
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
      'fsh_028480',
      'luteinizing_hormone_lh_83002',
      'prolactin_84146',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'initial_full',
    label: 'Initial – Full Panel',
    description: 'Complete initial workup including metabolic and hormones',
    testCodes: [
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
      'fsh_028480',
      'luteinizing_hormone_lh_83002',
      'prolactin_84146',
      'cbc_85025',
      'cmp_80053',
      'lipid_panel_80061',
      'shbg_84270',
      'dhea_sulfate_82627',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'followup_bare_min',
    label: 'TRT Follow-up – Bare Minimum',
    description: 'Standard 3-month TRT monitoring panel',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'followup_full',
    label: 'TRT Follow-up – Full',
    description: 'Extended follow-up panel for thorough monitoring',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
      'cmp_80053',
      'igf_1_84305',
      'lipid_panel_80061',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'followup_nandrolone',
    label: 'Follow-up on Nandrolone',
    description: 'Additional thyroid and metabolic monitoring for nandrolone',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
      'tsh_35167',
      'cmp_80053',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'followup_anavar',
    label: 'Follow-up on Anavar',
    description: 'Metabolic and lipid monitoring for Anavar',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'psa_31348',
      'cmp_80053',
      'lipid_panel_80061',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'annual',
    label: 'Annual Labs',
    description: 'Yearly monitoring labs while on TRT',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'symptomatic_fatigue',
    label: 'Symptomatic – Fatigue',
    description: 'For patients reporting fatigue symptoms',
    testCodes: [
      'cbc_85025',
      'testosterone_total_84403',
      'testosterone_free_84402',
      'estradiol_82670',
      'tsh_35167',
    ],
    diagnosisCodes: ['E29.1'],
  },
  {
    id: 'therapeutic_phlebotomy',
    label: 'Therapeutic Phlebotomy',
    description:
      'Phlebotomy alone — not eligible for discounted labs, must be a separate requisition',
    testCodes: [PHLEBOTOMY_CODE],
    requiredCodes: [PHLEBOTOMY_CODE],
    diagnosisCodes: ['R71.8'],
  },
]
