# Provider Portal

The clinical surface where a Provider reviews a Patient's labs and records a Disposition, or answers a Provider Question.

## Language

**Patient**:
A person under AlphaMD's care. In this portal they are the subject of a Lab Review or a Provider Question, not the person signed in.
_Avoid_: User, account, customer, client

**Provider**:
Staff allowed to read Lab Reviews and record a Disposition. Admin staff are included; other staff can sign in but cannot open the queue.
_Avoid_: User, doctor, clinician (unless a specific credential is meant)

**Lab Review**:
The work item this portal exists for: one Patient's labs waiting for, or undergoing, clinical review.
_Avoid_: Case, ticket, task

**Disposition**:
The clinical decision recorded when a Lab Review is finished. Which options are offered depends on whether the Patient is still Onboarding or is already a Member.
_Avoid_: Resolution, outcome, status (status is the queue column)

**Needs attention**:
A Lab Review parked before a Disposition is recorded. It stays with the assigned Provider unless they handed it to another Provider.
_Avoid_: Escalated (that means someone else has work), on hold, flagged

**Handoff**:
Giving a Lab Review to another Provider. Customer service never receives one.
_Avoid_: Assign (changing who holds it without parking)

**Onboarding**:
A Patient who does not yet have a subscription. Database status labels say "Non-Patient".
_Avoid_: Non-patient, lead, prospect

**Member**:
A Patient who has (or had) a subscription — active, paused, or cancelled. They already have a protocol to reason about.
_Avoid_: Active patient (paused and cancelled are Members too)

**Recommended Protocol**:
The priced treatment plan emailed to a Patient after a Lab Review.
_Avoid_: Quote (the price of the plan), POS, pricing email

**Subscription**:
The recurring product on a Recommended Protocol. Catalog Discounts come off this only.
_Avoid_: Plan (a plan is a duration of this)

**Ancillary**:
A one-off medication on a Recommended Protocol. Catalog Discounts do not apply to it.
_Avoid_: Add-on

**Catalog Discount**:
A named reduction off the Subscription, taken from the clinic's discount list (military, household, and the rest).
_Avoid_: Coupon, promo, add-on

**Coupon**:
A code assigned to a Patient that can set a first-month or target price. A different thing from a Catalog Discount.
_Avoid_: Discount (when the catalog list is meant)

**Add-on**:
A surcharge on a Subscription (dose, topical, and the like). Not a Catalog Discount.
_Avoid_: Discount

**Concentration**:
Milligrams of testosterone in each millilitre of an injectable vial. A property of the vial, not of how much the Patient takes.
_Avoid_: Strength, dose (that is Weekly dose), vial size (how much the pharmacy dispenses)

**Weekly dose**:
Milligrams of testosterone a Patient takes in a week. The figure a dose change is decided in.
_Avoid_: Amount (the pricing modal's word), concentration

**Analyte**:
One extracted lab value on a Lab Review: a name and the display string from the report.
_Avoid_: Chip, result (when this extracted row is meant)

**Clinic flag**:
A yellow or red highlight on an Analyte when its value crosses an AlphaMD threshold. A prompt for the Provider to look, not a Disposition.
_Avoid_: Needs attention, abnormal, high, alert, reference range

## Provider Questions

The portal's second work type. The full glossary lives in `alphamd/CONTEXT.md` → Provider Questions; these are the terms this repo's code uses.

**Provider Question**:
The provider-queue row for a patient medical question. Sibling of Lab Review. A patient may have many at once.
_Avoid_: Slack medical question, ticket (when you mean the work row)

**Pile**:
The list of Open Provider Questions in this portal. Queued rows and rows another Provider has, Urgent first then oldest first.
_Avoid_: queue (that word is the Lab Review list), inbox

**Question Assignee**:
The Working Provider who currently has the Provider Question. Any Provider may take it onto themselves, from queued or from someone else's in progress. Only the Question Assignee finishes it.
_Avoid_: original provider, prescribing provider (a different person shown on the row), Mine (the dashboard count of rows where I am Question Assignee)

**Urgent**:
A flag on a Provider Question. CS may set it at create; any Provider may turn it on or off. Finishing clears it.
_Avoid_: priority, high, Lab Review (this flag is not on Lab Reviews)

**Aged**:
An Open Provider Question whose create date is more than two weekdays ago. A visible mark only: no page, no auto-assign.
_Avoid_: past due, SLA, Lab Review

**Answer**:
The patient message that finishes a Provider Question. Required; there is no Disposition. The optional toolkit around it (dose change, labs, consultation, follow-up, request from CS) is the Lab Review's.
_Avoid_: Disposition, reply (when you mean the whole finish)

**Provider Question Note**:
The chart note written when a Provider Question is finished. AI summarizes what the Provider did. Staff open the Finished row from it in the admin app; the patient never sees it.
_Avoid_: Lab Review finish note, patient Zendesk message
