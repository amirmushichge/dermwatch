import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSingleImage,
  compareAnalyses,
} from "../lib/analysis.ts";

function analysis(overrides = {}) {
  return {
    version: 2,
    source: { width: 1600, height: 1200 },
    quality: {
      sharpness: 82,
      exposure: 96,
      resolution: 100,
      status: "good",
      ...overrides.quality,
    },
    segmentation: {
      confidence: 84,
      areaFraction: 0.04,
      diameterFraction: 0.23,
      centerOffset: 0.04,
      ...overrides.segmentation,
    },
    features: {
      asymmetry: 0.12,
      borderIrregularity: 0.2,
      colorVariation: 0.08,
      darknessContrast: 0.18,
      ...overrides.features,
    },
    appearance: {
      shapeGrid: "f".repeat(64),
      darknessHistogram: [0.1, 0.2, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02],
      relativeColor: [0.2, 0.18, 0.16],
      ...overrides.appearance,
    },
  };
}

test("same-day photos never produce an evolution result", () => {
  const previous = analysis();
  const current = analysis({
    features: {
      asymmetry: 0.45,
      borderIrregularity: 0.72,
      colorVariation: 0.34,
      darknessContrast: 0.46,
    },
  });
  const result = compareAnalyses(previous, current, undefined, undefined, 0);

  assert.equal(result.mode, "same-day-retake");
  assert.equal(result.reliability, "low");
  assert.equal(result.level, "stable");
  assert.match(result.message, /capture variation, not biological change/i);
});

test("weak focus blocks follow-up comparison", () => {
  const result = compareAnalyses(
    analysis(),
    analysis({ quality: { sharpness: 59, status: "review" } }),
    undefined,
    undefined,
    30,
  );

  assert.equal(result.mode, "follow-up");
  assert.equal(result.reliability, "low");
  assert.ok(result.captureIssues.includes("one photo is not sharp enough"));
});

test("review-quality single photos request a retake", () => {
  const result = assessSingleImage(
    analysis({ quality: { sharpness: 59, status: "review" } }),
  );

  assert.equal(result.level, "retake");
  assert.equal(result.action, "Retake the photo");
});

test("off-center detection blocks ABCDE measurements", () => {
  const result = assessSingleImage(
    analysis({ segmentation: { centerOffset: 0.57 } }),
  );

  assert.equal(result.level, "retake");
  assert.equal(result.flaggedCount, 0);
});

test("two elevated photo measurements do not trigger a clinical directive", () => {
  const result = assessSingleImage(
    analysis({
      features: {
        asymmetry: 0.4,
        borderIrregularity: 0.65,
        colorVariation: 0.08,
        darknessContrast: 0.18,
      },
    }),
  );

  assert.equal(result.flaggedCount, 2);
  assert.equal(result.level, "baseline");
  assert.equal(result.headline, "Baseline recorded");
  assert.doesNotMatch(result.action, /dermatologist|appointment/i);
});
