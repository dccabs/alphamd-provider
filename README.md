# Alpha MD Provider Portal

The provider-facing portal for Alpha MD. This is the beginning of migrating
provider tasks out of the main app's `/admin` section.

Next.js 16 (App Router) + Supabase + Vercel, with stock shadcn/ui for the
interface. It shares the **same Supabase project** as
[`dccabs/alphamd`](https://github.com/dccabs/alphamd), so accounts and passwords
are the same — but only `@alphamd.org` addresses can sign in here.

Current scope is authentication plus lab reviews: sign in, forgot password,
reset password, a dashboard summarising the queue, and the lab review queue and
review screen.

## Access rule

Any Supabase auth user whose email is on the `alphamd.org` domain may sign in.
Everyone else is signed straight back out. There is no signup form.

The check lives in `src/lib/allowedEmail.ts` and is a port of the main app's
`utils/adminAllowedEmail.ts`, so both portals answer "is this one of ours?" the
same way. It runs at four points, always against the **session's** email rather
than whatever was typed into the form:

| Where | Behaviour |
| --- | --- |
| `src/proxy.ts` | a session on a disallowed domain is treated as no session, on every route |
| `src/app/login/actions.ts` | after sign-in, signs out and shows an explicit message |
| `src/app/auth/callback/route.ts` | after the PKCE code exchange, signs out and redirects |
| `src/app/(portal)/page.tsx` | last-resort check before rendering the dashboard, via `checkProviderAccess()` |

`/forgot-password` also refuses to send to an address outside the domain, using
the same neutral response so the form cannot be used to enumerate accounts.

Note that this keys on the Supabase auth email, which users can change. Supabase
`double_confirm_changes` is on, so nobody can quietly move themselves into the
domain — but a provider who changes their email loses access. This is the
"in the meantime" rule; revisit in favour of the `provider` role once the portal
holds real features.

## Getting started

```bash
corepack enable              # once per machine, to get the pinned pnpm
pnpm install
cp .env.example .env.local   # then fill it in
pnpm dev
```

Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
`alphamd` Vercel project, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

Requires Node >= 20.9.0 (`next@16`). The package manager is **pnpm**, pinned by
the `packageManager` field in `package.json` — Corepack installs that exact
version, so don't use `npm` or `yarn` here and don't commit their lockfiles.

pnpm refuses to run dependency install scripts until each is explicitly allowed
in `pnpm-workspace.yaml`, and fails the install on anything unlisted. If a new
dependency trips that, add it there rather than working around it.

## Lab reviews

`/lab-reviews` is the provider queue; `/lab-reviews/[id]` is the review screen.
Both are gated a second time, beyond the sign-in domain rule: you also need the
`provider` or `admin` role. Anyone else who can sign in gets an explicit "no lab
review access" message rather than an empty page.

The dashboard at `/` applies the same role check but softer: without the role it
still renders, explaining why the queue is missing. It is where sign-in lands, so
denying it outright would leave such an account with nowhere to go.

**Roles are read from `user_roles_join`, never `user_list.role`.** That legacy
single-value column has zero `'provider'` rows in production, which is why the
main app's `requireStaff()` 403s real providers. `brandons@alphamd.org` — a
provider whose `user_list.role` is `''` — is the regression test for this.

For the same reason, lab-review data is read with the **service-role key** and
authorized in application code. Every relevant RLS policy checks that same dead
column, so reading through RLS returns empty arrays instead of errors. The key
lives in one `server-only` module (`src/lib/supabase/admin.ts`), an ESLint rule
bans importing it from client components, and the build is grepped to confirm it
never reaches the browser bundle.

### Writes

This portal is the **only** app that actions a lab review. The `alphamd` admin UI
still lists and opens reviews, but its assign, status and message-CS endpoints are
frozen — see `utils/labReviewFreeze.ts` there. Finishing a review has clinical
side effects (a flag cleared, a chart note written, a status changed), and two
apps implementing those differently against the same rows is how a patient ends up
with a flag cleared and no note. The freeze has a documented break-glass env var.

What `alphamd` deliberately keeps: everything that *creates* reviews (incoming
fax, upload notifications) and the summary pipeline that fills in `report_id`.
This portal does not replace those, and without them there would be no reviews.

Every write goes through `src/lib/labReviews/mutations.ts`, and every one of them:

1. takes a `ProviderAccess`, which only `checkProviderAccess()` can produce — so
   a server action cannot reach the database by forgetting its guard;
2. re-reads the review before changing it, because the page that rendered the
   button may be minutes stale;
3. appends a `lab_review_events` row, and **reports it when that append fails**.

The audit entry is not atomic with the change it records — supabase-js has no
cross-statement transaction — so a failed entry is surfaced as a warning saying
the change was saved but is missing from the history. A trail with invisible gaps
is worse than one that admits it is incomplete.

Claiming a review uses optimistic concurrency: the update only matches while
`assigned_to` is still null or already the caller's, so two providers opening the
same queue row cannot silently take it from each other. `started_at` is stamped
only when unset, so re-opening a review later does not reset the duration the
staffing numbers are derived from.

Draft autosave is the one write that does not append an audit entry per call — a
debounce would otherwise bury the real entries under hundreds of `draft_saved`
rows. What it records instead is `disposition_set`, when the clinical decision
actually changes. Autosave also does not revalidate, because re-rendering the
page under a provider mid-sentence would fight the fields they are editing; the
refresh happens once, when the flyout closes.

`lab_reviews.draft` is jsonb, so `parseDraft` validates every field on the way
in. It is reading data written by an older build of `reviewDraft.ts` the moment
that shape changes, and a malformed draft must degrade to an empty one rather
than make the review screen unopenable.

### Completing a review

Finishing a review is the riskiest write here: it clears a flag, may add others,
may change the patient's status, and writes a note onto the chart. So the
*decision* about which of those apply is a pure function in
`src/lib/labReviews/completion.ts`, unit-tested per disposition, and separate from
the code that applies it.

Two consequences worth knowing:

- **The review row is updated first**, then the side effects. There is no
  transaction across `lab_reviews`, `user_flags_join`, `user_list` and
  `patient_notes_private`, so something has to be the source of truth if the
  process dies halfway, and the review row is the only one that records the whole
  decision. A side effect that fails comes back as a warning naming the specific
  thing that did not apply — not as an error, because the review *is* finished and
  reporting failure would send the provider to do it twice.
- **"Treatment recommended" does not move the patient to "Pricing sent to PT".**
  Recommending treatment is not the same as having sent pricing, and the pricing
  tool does not live here. It raises "Follow Up Required" instead.

Flag and status ids are named in `src/lib/labReviews/clinicalIds.ts`. They are
bare numbers in the main app; a literal `6` in a completion path is unreviewable,
and being wrong means a flag on a chart that says something untrue.

### Needs attention

Escalation routes to customer service, another provider, or both at once. The rule
worth knowing: **customer service never owns a lab review.** Escalating to CS
creates an `actions` row, points `lab_reviews.cs_action_id` at it, and flags the
patient — but leaves `assigned_to` alone, because CS cannot make the clinical
decision that closes the review. Only the provider route moves the review.

Every escalation also records a `lab_review_notes` row. That is the second note
type: notes *about the review* rather than about the patient. A handoff reason
belongs there and not in `patient_notes_private`, which is the clinical chart —
"escalating because I want a second opinion on the Hct trend" is workflow, not
medical record.

### Ordering labs

"Order labs" in the review's action menu places an order now or on a future date
(6/8/10/12 weeks, 6 months, or a picked date). Already-scheduled orders are listed
in the same panel and can be cancelled — a provider who cannot see that a redraw
was scheduled last week orders a second one, and the patient pays twice and visits
a lab twice.

**Both "now" and "in twelve weeks" write the same table: `scheduled_lab_requisitions`.**
The main app has two paths — an immediate order inserts `lab_requisitions` and its
UI then calls a second endpoint that emails the patient, while a future order waits
for the `process-scheduled-labs` cron. This portal only ever writes the scheduled
table; an order placed "now" is a scheduled order dated now, and the cron (which
stays in the main app, running every five minutes) inserts the real requisition,
emails the patient their order link, and texts them.

The alternative was porting Paubox email, PDF generation and Telnyx SMS into a
second app, or inserting a `lab_requisitions` row that nobody ever emails — a
provider believing labs were ordered while the patient never hears. Up to five
minutes of delay is the price, and nothing about a lab order needs to be faster
than that.

Consequences worth knowing:

- The columns written are a **contract with that cron**, not a local choice. It
  filters on `status = 'pending'`, compares `scheduled_date` to now, and copies
  `requests` / `diagnosis_code` through verbatim. `status`, `lab_requisition_id`
  and `processed_at` are left to their defaults because they are the cron's to set.
- `requests` stores the **whole catalogue** with an `is_requested` flag per row,
  not just the selected tests, because that is the shape the cron, the patient
  emails and the patient order page all read.
- An immediate order sets `notification_email_sent_at` on insert. That suppresses
  the cron's "your labs are scheduled for <date> — this is NOT for now" heads-up,
  which would otherwise arrive in the same cron run as the order itself and
  contradict it.
- Orders are refused for patients whose status is 10 (cancelled) or 23 (dropped),
  mirroring the cron's own block list. The cron silently leaves such rows pending
  until they expire a week later, so accepting one here would look successful and
  never arrive.
- Discounted ("covered by AlphaMD") tests are unavailable in New York and New
  Jersey. The restriction is re-checked server-side against `user_list.state`, not
  the value the browser was rendered with.
- Therapeutic phlebotomy must be ordered alone. Enforced in `validateOrder`, not
  just hinted in the UI, because the lab enforces it downstream — after the patient
  has been told the order was placed.
- `lab_orders/catalog.ts` is a **copy** of the main app's
  `constants/labRequisitions.ts` and `constants/scheduledLabPresets.ts`. The two can
  drift; a change to the clinical catalogue belongs in both. The `code` values are
  an interface — the main app reads them back — so none may be renamed.

Unlike `lab_reviews`, this table is deliberately written by both apps. The main
app's Schedule Future Labs modal is reachable from pages that have nothing to do
with lab reviews, and both writers only ever insert `pending` rows for the same
cron to process, so there is no equivalent of the split-brain problem that made
freezing the lab-review UI necessary.

### Requesting a consultation

"Request a consultation" mints a **single-use** Calendly scheduling link and emails
it to the patient through Paubox. `max_event_count: 1` is what makes it single-use:
the link dies once they book, so a forwarded email cannot fill a second slot on a
provider's calendar. The patient's name and email are prefilled onto the booking
URL because the main app's booking webhook matches the invitee back to a
`user_list` row **by email** — a patient who types a different address books an
appointment that never links to their chart.

The three steps are ordered so a failure never leaves the patient misinformed: mint
the link, send the email, and only then record it. An unused link costs nothing, so
a failed send is reported as an error with the link kept on screen to copy; writing
the chart note before the send would assert an invitation that never went out.

Two deliberate differences from the main app's Send Consultation Link modal:

- **The request is recorded.** The main app writes nothing at request time, so
  whether a patient was ever asked to book is invisible until they actually do.
  Here it lands on the chart and in the review's audit trail.
- **Upcoming consultations are shown in the panel.** A provider who cannot see that
  the patient is already booked for Thursday sends a second invitation, which the
  patient reasonably reads as "the first one didn't work".

The consultation types are ordered by what suits the patient rather than filtered
to it — `eventTypesFor` puts the appropriate ones first and keeps the rest one
click away, because `user_list.status` and recorded gender are both routinely stale
or blank and a provider who knows the patient should not be blocked by a field that
disagrees.

`src/lib/consultations/eventTypes.ts` holds live Calendly event type UUIDs, copied
from the main app. The main app already keeps four copies of this list which have
drifted — the same clinician appears under different UUIDs in different places — so
this being a fifth copy is worth stating plainly: **if Calendly's event types
change, this file must change too, and nothing will fail loudly if it doesn't.**

Booking itself is untouched. The patient books through Calendly, Calendly fires
`invitee.created` at the main app's webhook, and that is what writes
`user_consultation_schedules` — which is where the Consults tab reads from.

### AI drafting

Three fields have a **Draft with AI** button: the chart note in the flyout, the
handoff note on an escalation, and a customer-service reply. All three go through
`POST /api/ai/draft` — the only route handler in this app, because a server action
cannot stream and a clinical note that appears a word at a time is the difference
between responsive and hung.

Ported from the main app's `pages/api/admin/ai-reply-assistant.ts`: the model, the
token budget, the plain-text streaming transport, and the patient-context query
set. Three things are deliberately not ported:

- **The prompts.** That route writes customer service email — warm, addressed to
  the patient, signed "AlphaMD Support". A chart note is a clinical record in the
  third person and a handoff note is a message to a colleague. Reusing the email
  prompt for either produces a chart note that opens by thanking the patient for
  reaching out. See `src/lib/ai/prompts.ts`.
- **The FAQ and past-email knowledge base search.** Those call endpoints on the
  main app. Out of scope until there is a caller that needs them.
- **The single try/catch around all seven context queries.** Each query now fails
  independently (`src/lib/ai/patientContext.ts`), because the original's failure
  mode was to silently empty the whole context and draft from nothing while
  looking like it had everything.

Two properties of the client behaviour are load-bearing and worth preserving. The
provider's own text is **sent as the starting point and never silently replaced** —
the model is told to revise, and Undo restores the original. And the model is told
what the provider has already decided (`src/lib/ai/decision.ts`), because the
disposition exists only in the unsaved draft; without it the model describes the
bloodwork correctly and then guesses at the plan, which is precisely the sentence a
clinician should not have to catch.

`OPENAI_API_KEY` is optional. Unset, the buttons report that the assistant is not
configured and every field stays typeable.

### Not yet wired to real data

Everything on the screen is live except the following, and each one is visibly
marked in the UI. **An unlabelled static region is a bug.**

| What | Why | What unblocks it |
| --- | --- | --- |
| Up/down arrows on the AI chips | The extracted JSON stores display strings with no reference interval and no H/L flag, and there is no reference-range table anywhere in the database | Extending the extraction prompt to capture the range the lab report already prints. Chips ship without arrows rather than hardcoding clinical thresholds in front-end code. |
| Billing tab | Dropped from this iteration | Next iteration: `transactions_v4` plus an unpaid-balance flag. Note `collection_status` is the dunning state, not the payment state — 8,280 paid invoices read `pending`. |

### Known rough edges

- **PDF page controls duplicate the browser's own.** Chrome and Firefox render
  embedded PDFs with their own toolbar, so there are two sets of page/zoom
  controls. Ours drive the browser viewer through the `#page=` fragment and do
  work. Removing the duplication needs a bundled renderer (pdf.js), which is a
  bigger change than this one.
- **Some files are mislabelled at rest.** At least one `.pdf` in the bucket is
  actually HTML — a broken upload, and the subject of that patient's own CS
  thread. Classification is by extension, so such a file will open blank.
- CS comments are mirrored Zendesk emails, so they include signatures and
  confidentiality footers. They are rendered in full; truncating patient
  communications silently would be worse.

## Environment variables

See `.env.example`. `SUPABASE_SECRET_KEY` is required for `/lab-reviews`. The rest
gate one feature each and degrade to a plain "not configured in this environment"
message rather than a broken screen: `ZENDESK_API_TOKEN` to send a
customer-service reply, `OPENAI_API_KEY` for the Draft with AI buttons, and
`CALENDLY_AUTH_TOKEN` plus `PAUBOX_API_USERNAME` / `PAUBOX_API_KEY` to request a
consultation.

## Deployment notes

Two things must be set up outside this repo before password reset works on a
deployed environment:

1. Add the deployed origin's `/auth/callback` URL to **Authentication → URL
   Configuration → Redirect URLs** in the Supabase dashboard. Without it,
   reset links fall back to the project Site URL (`alphamd.org`).
2. Set `NEXT_PUBLIC_SITE_URL` per Vercel environment to that environment's own
   domain.

Password reset uses PKCE with this app's own `/auth/callback` route, so no
Supabase email template change is needed and the main app's reset flow is
untouched.

## Conventions

- App Router, Server Components by default; the three forms are client
  components driven by Server Actions.
- UI is stock **shadcn/ui** (`base-nova` preset — Base UI primitives, Lucide
  icons, Geist, neutral theme). Components live in `src/components/ui` and are
  owned by this repo; add more with `pnpm dlx shadcn@latest add <name>`. This is a
  deliberate fresh start — do **not** port the main app's palette or
  components across. Note Base UI uses a `render` prop rather than Radix's
  `asChild`.
- Supabase access goes through `@supabase/ssr` (`src/lib/supabase/*`), not the
  deprecated `@supabase/auth-helpers-*` that the main app still uses.
- Request-level auth lives in `src/proxy.ts`. Next 16 deprecates the
  `middleware` file convention in favour of `proxy` — do not add a
  `middleware.ts`, and do not add `export const runtime` to the proxy.
- `next lint` no longer exists in Next 16. Lint with `pnpm lint` (`eslint`).
