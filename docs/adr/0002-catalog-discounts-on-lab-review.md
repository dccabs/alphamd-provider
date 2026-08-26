# Catalog discounts are chosen on a flyout step, not by porting POS

A Lab Review that emails a Recommended Protocol must be able to apply Catalog Discounts. We did not port the admin POS “Discounts & Add-ons” block (coupons, add-on surcharges, and catalog checkboxes in one `discountOptions` object). We added a Discounts step after New medications that shows the live quote and the catalog list, and we left Finalize read-only.

## Why

The engine already prices Catalog Discounts; this portal was quoting list and asking CS to fix it. Putting the picker on New medications mixes the clinical choice with the commercial one. Putting it on Finalize would break that screen’s read-only contract. Auto-applying every POS rule by discount name is how that UI got fragile.

Newsletter (catalog id 6) and the Patient’s assigned, unexpired Coupon start on and can be taken off. Other Catalog Discounts stay unchecked. An expired assigned Coupon is shown, not applied, until the Provider checks it. Eligibility-at-intake remains the destination; this picker is the interim.

## Consequence

If the Provider changes the Subscription after picking discounts, stale checks stay on the draft. The quote and the snapshot use only what this product allows. Finalize lists what is on the quote versus what was checked but not used.
