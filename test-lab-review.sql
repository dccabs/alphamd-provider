-- ---------------------------------------------------------------------------
-- Test fixture: one lab review for Dan Test Cabaniss, built on "test lab.pdf"
--
-- Patient : c25cbb95-ea0c-4831-ab8e-3b889b13f48a  (Dan Test Cabaniss, Texas)
-- File    : user_files 5859 — "test lab.pdf"
--           original-test-results/test-results/0f655ebc-7a18-437c-91d4-8349196788ae.pdf
--           (confirmed present in the original-test-results bucket)
--
-- Everything this creates carries a deadbeef-… id or a 'test-fixture:' key, so
-- section 5 at the bottom removes the whole thing and nothing else.
--
-- Run sections 1 and 2. Sections 3 and 4 are optional but change what you are
-- able to test — read their notes. Section 5 is the undo.
--
-- The review is always reachable directly, whatever the queue is doing:
--   http://localhost:3000/lab-reviews/deadbeef-0000-4000-8000-000000000001
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. The parsed lab and the AI summary
-- ===========================================================================
-- A new lab_review_reports row rather than an edit to the patient's existing
-- one (2be8665a-…), which stays untouched. Only "test lab.pdf" is referenced,
-- and there is a single collection, so the values card has nothing stale in it.
--
-- The values are deliberately a picture that argues for lowering the dose:
-- hematocrit 53.2%, total T 1142 ng/dL, estradiol 58 pg/mL. That gives the dose
-- change, consultation and lab-order paths something honest to act on.

insert into lab_review_reports (id, user_id, patient_name, patient_summary, lab_analysis_results, uploaded_files, batch_id, created_at)
values (
  'deadbeef-0000-4000-8000-000000000002',
  'c25cbb95-ea0c-4831-ab8e-3b889b13f48a',
  'Dan Test Cabaniss',
  $md$# Clinical Summary for Lab Review

## Current Treatment Context

Patient is on testosterone cypionate, injecting **0.4 mL subcutaneously twice weekly** (approximately 160 mg per week). Anastrozole and HCG appear on the protocol but both have lapsed expirations.

## Key Findings

- **Total testosterone 1142 ng/dL** — above the target range for maintenance therapy.
- **Hematocrit 53.2%** — above the 52% threshold at which dose reduction is normally considered.
- **Hemoglobin 17.4 g/dL** — consistent with the raised hematocrit.
- **Estradiol 58 pg/mL** — elevated, in keeping with the supratherapeutic testosterone level.
- **LH 0.4 mIU/mL** — suppressed, as expected on exogenous testosterone.
- **PSA 1.4 ng/mL** — within normal limits for age.

## Considerations for the Reviewing Provider

1. Erythrocytosis is the most pressing finding. A dose reduction is the usual first step, with a repeat CBC in six to eight weeks.
2. Estradiol is likely to fall on its own once the testosterone dose comes down.
3. Worth confirming hydration status and timing of the draw relative to the last injection before reading too much into the peak level.
4. No finding here requires urgent escalation.

*This summary is generated from the uploaded lab report and is intended to support, not replace, provider review.*$md$,
  $json$
  {
    "success": true,
    "userId": "c25cbb95-ea0c-4831-ab8e-3b889b13f48a",
    "patientName": "Dan Test Cabaniss",
    "totalFiles": 1,
    "labFilesFound": 1,
    "labResults": [
      {
        "date": "8/10/26",
        "fileName": "test lab.pdf",
        "collectionDate": "08/03/26",
        "values": {
          "Total Testosterone": "1142 ng/dL",
          "Free Testosterone": "241 pg/mL",
          "Estradiol": "58 pg/mL",
          "SHBG": "19 nmol/L",
          "Hemoglobin": "17.4 g/dL",
          "Hematocrit": "53.2%",
          "Prolactin": "6.1 ng/mL",
          "PSA": "1.4 ng/mL",
          "LH": "0.4 mIU/mL"
        }
      }
    ],
    "data": {
      "userId": "c25cbb95-ea0c-4831-ab8e-3b889b13f48a",
      "patientName": "Dan Test Cabaniss",
      "notesLink": "https://www.alphamd.org/admin/users/c25cbb95-ea0c-4831-ab8e-3b889b13f48a/notes",
      "labs": [
        {
          "date": "8/10/26",
          "fileName": "test lab.pdf",
          "collectionDate": "08/03/26",
          "values": {
            "Total Testosterone": "1142 ng/dL",
            "Free Testosterone": "241 pg/mL",
            "Estradiol": "58 pg/mL",
            "SHBG": "19 nmol/L",
            "Hemoglobin": "17.4 g/dL",
            "Hematocrit": "53.2%",
            "Prolactin": "6.1 ng/mL",
            "PSA": "1.4 ng/mL",
            "LH": "0.4 mIU/mL"
          }
        }
      ]
    }
  }
  $json$::jsonb,
  $json$[{"fileName": "test lab.pdf", "uploadedAt": "2026-08-10T14:02:00+00:00", "description": "testing"}]$json$::jsonb,
  null,
  now()
);


-- ===========================================================================
-- 2. The review itself, its source file, and the queue flag
-- ===========================================================================
-- Left unclaimed on purpose: assigned_to, started_at and draft are all null, so
-- the review opens on "Start this review" and you exercise the claim path too.
--
-- summary_status 'ready' is what makes the AI tab show the summary above rather
-- than a pending spinner.
--
-- The timestamps are now() rather than fixed, because the queue sorts on
-- last_source_at descending against ~77 active reviews. Backdating this by even
-- a few days buries it most of the way down the list.

insert into lab_reviews (id, patient_id, status, report_id, summary_status, summary_attempts, first_source_at, last_source_at, created_at, updated_at)
values (
  'deadbeef-0000-4000-8000-000000000001',
  'c25cbb95-ea0c-4831-ab8e-3b889b13f48a',
  'active',
  'deadbeef-0000-4000-8000-000000000002',
  'ready',
  1,
  now(),
  now(),
  now(),
  now()
);

-- file_path is what pins the PDF viewer to "test lab.pdf". Without it the page
-- falls back to the patient's newest lab-ish file, which for this account is an
-- unrelated 2024 PDF.
insert into lab_review_sources (lab_review_id, source, dedupe_key, report_id, user_file_id, file_path, occurred_at)
values (
  'deadbeef-0000-4000-8000-000000000001',
  'admin_upload',
  'test-fixture:dan-test-lab-review-1',
  'deadbeef-0000-4000-8000-000000000002',
  5859,
  'original-test-results/test-results/0f655ebc-7a18-437c-91d4-8349196788ae.pdf',
  now()
);

-- "Needs lab review" (flag 3). The patient does not currently carry it, and
-- finalizing is supposed to clear it — so without this there is nothing to
-- watch get cleared.
-- last_updated_by is NOT NULL, and production sets it to the patient themselves
-- for this flag, since it is a patient upload that raises it.
insert into user_flags_join (patient_id, flag_id, description, active, created_at, last_updated_by)
select 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a', 3, 'Test fixture — new labs received', true,
       now(), 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a'
where not exists (
  select 1 from user_flags_join
  where patient_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a' and flag_id = 3
);


-- ===========================================================================
-- 3. OPTIONAL — make the patient an active member
-- ===========================================================================
-- Today this account is status 1, "Non-Patient - Registered". That status gates
-- the review to the onboarding dispositions only (treatment recommended /  not
-- recommended) and offers the non-member consultation types.
--
-- Run this to get the member paths instead: continue protocol, dose change and
-- follow-up needed, plus the member consultation types. You almost certainly
-- want this, given dose changes are the thing worth testing hardest.
--
-- Section 5 puts it back to 1.

update user_list
set status = 8   -- 'Patient, Active Subscription'
where user_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a';


-- ===========================================================================
-- 4. OPTIONAL — un-expire the other two medications
-- ===========================================================================
-- Of the three medications on this account only testosterone cypionate is
-- current. Anastrozole expired 2026-01-27 and HCG expired 1999-10-01, so the
-- dose-change picker offers exactly one medication and you cannot test editing
-- several in one review (ALP-2).
--
-- This pushes both a year out. Section 5 restores the original dates.

update patient_medications set expiration = '2027-08-16' where id = 5680;  -- Anastrozole
update patient_medications set expiration = '2027-08-16' where id = 7456;  -- HCG


-- ===========================================================================
-- 5. UNDO — removes the fixture and reverts sections 3 and 4
-- ===========================================================================
-- Run the whole section to get back to where you started. Deleting the review
-- cascades to lab_review_sources, and to anything the review wrote about
-- itself, but a *finalized* review will have written outside these tables —
-- notes, medication rows, lab requisitions, a consultation. Those are listed at
-- the end for you to check by hand.

-- delete from lab_reviews where id = 'deadbeef-0000-4000-8000-000000000001';
-- delete from lab_review_reports where id = 'deadbeef-0000-4000-8000-000000000002';
-- delete from user_flags_join where patient_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a' and flag_id = 3;
-- update user_list set status = 1 where user_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a';
-- update patient_medications set expiration = '2026-01-27' where id = 5680;
-- update patient_medications set expiration = '1999-10-01' where id = 7456;

-- What a finalized run leaves behind elsewhere, to inspect before re-testing:
--   select * from lab_review_events where lab_review_id = 'deadbeef-0000-4000-8000-000000000001';
--   select * from patient_medications where user_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a' order by created_at desc;
--   select * from user_flags_join where patient_id = 'c25cbb95-ea0c-4831-ab8e-3b889b13f48a';
--   -- plus any lab requisition and any Calendly consultation minted during the run
