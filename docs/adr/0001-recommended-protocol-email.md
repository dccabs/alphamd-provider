# 0001. Recommended protocol email is the POS template, ported

The Patient who is emailed a recommended protocol from a Lab Review receives the same HTML letter as one sent from the admin app's pricing modal.

## Decision

Port `PricingProtocolEmail` into this repo. Map the quote into that template's dollar payload, render it here, and send it through this app's Paubox. Do not call `POST /api/send-pricing-email` on alphamd.

## Why

That endpoint is a session-authenticated wrapper around the template. It does not create the quote, and this portal does not hold an alphamd session. The letter the Patient sees is the template, not the route.

## Consequence

Two copies until a shared package exists. Markup changes must be mirrored, or this file replaced.
