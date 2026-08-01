# Technical transparency

## No hidden AI model

The current DermWatch release does not contain a pretrained neural network,
large language model, dermatology classifier, external model endpoint, model
weights, or clinical dataset.

The browser processes each photo locally using deterministic image-processing
code in [`lib/analysis.ts`](lib/analysis.ts). The current workflow:

1. downsamples the image to a fixed analysis canvas;
2. estimates sharpness, exposure, and source resolution;
3. finds the largest visually distinct region relative to surrounding skin;
4. measures approximate asymmetry, border irregularity, color variation, and
   pigment contrast;
5. compares shape and color descriptors between follow-up images.

These are experimental, hand-written heuristics. They have not been trained or
validated on a clinical dataset and do not provide known sensitivity,
specificity, or diagnostic accuracy.

## What a result means

A DermWatch result describes visible measurements in the supplied image. It
does not determine whether a lesion is benign or malignant. Different lighting,
distance, focus, camera processing, skin deformation, or the wrong spot can
change the measurements.

## Data flow

Photos and records stay on the local device. The desktop application starts two
loopback-only services: one serves the interface and one stores records. The
storage service accepts requests only from the exact local interface origin
created for the current application session. Android stores metadata and images
directly in the app-private data directory and disables operating-system backup.

## Future models

If a future release adds a third-party model, dataset, or weights, its name,
version, source, license, intended use, limitations, and validation status must
be documented here and in the release notes before publication.
