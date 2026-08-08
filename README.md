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
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
`alphamd` Vercel project, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

Requires Node >= 20.9.0 (`next@16`).

## Environment variables

See `.env.example`. There is deliberately **no service-role key** — the access
gate reads no tables, so this deployment never needs one.

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
  owned by this repo; add more with `npx shadcn@latest add <name>`. This is a
  deliberate fresh start — do **not** port the main app's palette or
  components across. Note Base UI uses a `render` prop rather than Radix's
  `asChild`.
- Supabase access goes through `@supabase/ssr` (`src/lib/supabase/*`), not the
  deprecated `@supabase/auth-helpers-*` that the main app still uses.
- Request-level auth lives in `src/proxy.ts`. Next 16 deprecates the
  `middleware` file convention in favour of `proxy` — do not add a
  `middleware.ts`, and do not add `export const runtime` to the proxy.
- `next lint` no longer exists in Next 16. Lint with `npm run lint` (`eslint`).
