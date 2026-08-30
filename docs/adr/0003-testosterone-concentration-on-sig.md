# Generated testosterone instructions always name the Concentration

A Lab Review that writes an injectable testosterone instruction must state the vial Concentration (20, 50, or 200 mg/mL). The next review reads Weekly dose from millilitres × Concentration, and an unstated 20 or 50 would be multiplied as 200.

## Why

The calculator used to assume every cypionate/enanthate vial was 200 mg/mL and omitted it from the sentence. The admin pricing modal already dispenses 20 and 50 by gender (50 only for California females). Keeping the assumption would show a Provider ten times the Weekly dose.

## Consequence

`readDose` accepts 20, 50, and 200. Any other stated Concentration stays opaque. An instruction that never names one is still read as 200, because that is what every existing house sig assumed. Vial size and oil stay off the instruction; they are pharmacy details, not the clinical decision.
