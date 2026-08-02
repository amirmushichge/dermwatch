# DermWatch v0.2.3

DermWatch v0.2.3 prevents capture differences from being presented as
biological change.

## What changed

- photos taken on the same day are treated as retakes, not evolution;
- Evolution and Change index are withheld when photos are not comparable;
- weak focus, unstable spot detection, changed scale, and changed framing now
  block the comparison;
- off-center segmentation blocks ABCDE measurements instead of producing a
  false Border result;
- a single photo no longer generates an automatic dermatologist-booking
  directive from two experimental measurements;
- upload previews explain how to correct focus, framing, and shadows;
- Android is explicitly kept in the light color scheme so system auto-dark
  processing cannot alter the intended photo-review interface;
- regression coverage now includes same-day, low-sharpness, off-center, and
  multi-feature scenarios.

## Medical limitation

DermWatch does not detect or rule out skin cancer or melanoma. Its image
measurements remain experimental and have not been clinically validated. New,
changing, different, itching, bleeding, or otherwise concerning spots should
be assessed by a qualified clinician regardless of the app result.
