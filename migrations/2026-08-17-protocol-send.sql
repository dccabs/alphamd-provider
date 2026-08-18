-- Recommended protocols sent from the provider portal.
--
-- Two nullable columns, no backfill, no changes to existing behaviour. Both are
-- additive so the admin app keeps working untouched: it writes neither, and
-- neither is NOT NULL.
--
-- Run in the Supabase SQL editor.

-- 1. Which algorithm priced a snapshot.
--
-- Until now every row in this table came from one calculator, running in an
-- admin's browser. From now on some come from the provider portal's engine
-- instead (src/lib/protocols), and although the two are proven to agree — the
-- engine is verified by replaying 238 real rows to the cent — "proven to agree
-- today" is not the same as "indistinguishable forever".
--
-- Without this column, the first deliberate pricing change makes every older row
-- ambiguous: a total that no longer reproduces could be a bug or could be a rule
-- that changed, and nothing on the row says which. Stamping the producer means a
-- future reader can replay history against the algorithm that actually priced it.
--
-- Null means the admin app's client-side calculator, which is every row written
-- before this migration.
alter table public.pricing_snapshots
  add column if not exists pricing_version text;

comment on column public.pricing_snapshots.pricing_version is
  'Which pricing algorithm produced this row. Null = the admin app''s client-side calculator. "provider-v1" = alphamd-provider src/lib/protocols.';

-- 2. Which lab review produced a protocol.
--
-- Traceability, not idempotency: a review can only be finished once, because
-- completeLabReview finishes it with a compare-and-swap, so a second send is
-- already impossible. What this buys is the ability to answer "where did this
-- protocol come from" — and to notice a duplicate if that guard is ever loosened.
--
-- Null means it was sent from the admin app's pricing modal, which is every row
-- written before this migration.
alter table public.medication_protocols
  add column if not exists lab_review_id uuid;

comment on column public.medication_protocols.lab_review_id is
  'The lab_reviews row whose approval sent this protocol. Null = sent from the admin app''s pricing modal.';

-- Partial, because the overwhelming majority of rows will have a null here for a
-- long time and there is no point indexing those.
create index if not exists medication_protocols_lab_review_id_idx
  on public.medication_protocols (lab_review_id)
  where lab_review_id is not null;
