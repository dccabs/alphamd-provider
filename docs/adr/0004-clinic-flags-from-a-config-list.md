# Clinic flags come from an AlphaMD config list, not the lab's printed range

The extracted JSON is display strings with no reference interval. Providers need to notice a handful of dose-change and safety values during a Lab Review, so we color those Analytes from a small in-repo threshold list (yellow = approaching, red = at or past). The list is a suggestion so the number gets seen; the Provider still decides. The long-term honest source is the interval printed on the PDF, which we do not extract yet.

## Why not wait

Shipping no color until extraction captures each lab's range would leave Hematocrit and Estradiol quiet — the two values Saba most often changes dose on. Hardcoding published "normal" male ranges would paint on-treatment Total Testosterone as high. A named config list is the reversible middle: the numbers can move when her written list arrives, and Free T / Total T / SHBG / LH stay uncolored on purpose.
