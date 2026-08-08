# Alpha MD Provider Portal

The provider-facing portal for Alpha MD. This is the beginning of migrating
provider tasks out of the main app's `/admin` section.

Next.js 16 (App Router) + Supabase + Vercel, with stock shadcn/ui for the
interface. It shares the **same Supabase project** as
[`dccabs/alphamd`](https://github.com/dccabs/alphamd), so accounts and passwords
are the same — but only `@alphamd.org` addresses can sign in here.

Current scope is login only: sign in, forgot password, reset password, and a
placeholder dashboard.

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
| `src/app/(portal)/page.tsx` | last-resort check before rendering the dashboard |

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

### Not yet wired to real data

Everything on the screen is live except the following, and each one is visibly
marked in the UI. **An unlabelled static region is a bug.**

| What | Why | What unblocks it |
| --- | --- | --- |
| Review modal (protocol decision, dose change, new medications, concerns, CS instructions, Save draft, Finalize) | `lab_reviews` has only a free-text `resolution` column — no structured outcome and no draft state | A `lab_review_outcomes` table. The modal is interactive so the interaction can be reviewed, behind a "Draft only — not saved" banner. |
| Assign, Mark complete, More actions | Writes; they map to columns that already exist (`assigned_to`, `status`, `resolution`) | The next change. Labelled "Next change" in the menu. |
| Assign instructions textarea | No column exists for it | An `assigned_note` column. Rendered **disabled** rather than accepting clinical text it would discard. |
| "Generate new protocol" | Not traced to an implementation in the main app | Reading the real flow before wiring it. Labelled "Not wired". |
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

See `.env.example`. `SUPABASE_SECRET_KEY` is required for `/lab-reviews`;
`ZENDESK_API_TOKEN` is required only to send a customer-service reply.

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
