# Provider Portal

The clinical surface where a Provider reviews a Patient's labs and records a Disposition.

## Language

**Patient**:
A person under AlphaMD's care. In this portal they are the subject of a Lab Review, not the person signed in.
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
