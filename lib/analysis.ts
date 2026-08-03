export type AnalysisResult = {
  version: 1 | 2;
  source: {
    width: number;
    height: number;
  };
  quality: {
    sharpness: number;
    exposure: number;
    resolution: number;
    status: "good" | "review" | "retake";
  };
  segmentation: {
    confidence: number;
    areaFraction: number;
    diameterFraction: number;
    centerOffset: number;
  };
  features: {
    asymmetry: number;
    borderIrregularity: number;
    colorVariation: number;
    darknessContrast: number;
  };
  appearance?: {
    shapeGrid: string;
    darknessHistogram: number[];
    relativeColor: [number, number, number];
  };
};

export type ChangeResult = {
  score: number;
  level: "stable" | "noticeable" | "substantial";
  reliability: "good" | "low";
  mode: "same-day-retake" | "follow-up";
  identity: "same" | "uncertain" | "different";
  identityScore?: number;
  captureIssues: string[];
  message: string;
  factors: Array<{
    key: string;
    label: string;
    value: number;
  }>;
};

export type SingleImageAssessment = {
  level: "retake" | "baseline" | "attention";
  headline: string;
  message: string;
  action: string;
  flaggedCount: number;
  factors: Array<{
    code: "A" | "B" | "C" | "D" | "E";
    label: string;
    value?: number;
    state: "clear" | "attention" | "unknown";
    detail: string;
  }>;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const toScore = (value: number) => Math.round(clamp(value) * 100);

function serializeBits(bits: Uint8Array) {
  let result = "";
  for (let index = 0; index < bits.length; index += 4) {
    const nibble =
      (bits[index] << 3) |
      (bits[index + 1] << 2) |
      (bits[index + 2] << 1) |
      bits[index + 3];
    result += nibble.toString(16);
  }
  return result;
}

function deserializeBits(value: string) {
  const bits = new Uint8Array(value.length * 4);
  for (let index = 0; index < value.length; index += 1) {
    const nibble = Number.parseInt(value[index], 16);
    bits[index * 4] = (nibble >> 3) & 1;
    bits[index * 4 + 1] = (nibble >> 2) & 1;
    bits[index * 4 + 2] = (nibble >> 1) & 1;
    bits[index * 4 + 3] = nibble & 1;
  }
  return bits;
}

function transformGrid(
  source: Uint8Array,
  size: number,
  rotation: number,
  flip: boolean,
) {
  const result = new Uint8Array(source.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let tx = flip ? size - 1 - x : x;
      let ty = y;
      for (let turn = 0; turn < rotation; turn += 1) {
        [tx, ty] = [size - 1 - ty, tx];
      }
      result[ty * size + tx] = source[y * size + x];
    }
  }
  return result;
}

function shapeDistance(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 1;
  const first = deserializeBits(a);
  const second = deserializeBits(b);
  const size = Math.round(Math.sqrt(first.length));
  let best = 1;

  for (const flip of [false, true]) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const transformed = transformGrid(second, size, rotation, flip);
      let intersection = 0;
      let union = 0;
      for (let index = 0; index < first.length; index += 1) {
        if (first[index] || transformed[index]) union += 1;
        if (first[index] && transformed[index]) intersection += 1;
      }
      best = Math.min(best, union ? 1 - intersection / union : 1);
    }
  }
  return best;
}

function histogramDistance(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 1;
  return clamp(
    a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / 2,
  );
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function largestComponent(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(mask.length);
  let best: number[] = [];
  const queue = new Int32Array(mask.length);

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];

    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          mask[neighbor] &&
          !visited[neighbor]
        ) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }

    if (component.length > best.length) best = component;
  }
  return best;
}

export async function analyzeImage(file: File): Promise<AnalysisResult> {
  const bitmap = await createImageBitmap(file);
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const analysisSize = 256;
  const canvas = document.createElement("canvas");
  canvas.width = analysisSize;
  canvas.height = analysisSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is unavailable");

  const scale = Math.max(analysisSize / bitmap.width, analysisSize / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (analysisSize - drawWidth) / 2,
    (analysisSize - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  bitmap.close();

  const image = context.getImageData(0, 0, analysisSize, analysisSize);
  const pixels = image.data;
  const gray = new Float32Array(analysisSize * analysisSize);
  let clipped = 0;
  let laplacianSum = 0;
  let laplacianSq = 0;
  let laplacianCount = 0;

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const value =
      0.2126 * pixels[offset] +
      0.7152 * pixels[offset + 1] +
      0.0722 * pixels[offset + 2];
    gray[index] = value;
    if (value < 12 || value > 245) clipped += 1;
  }

  for (let y = 1; y < analysisSize - 1; y += 1) {
    for (let x = 1; x < analysisSize - 1; x += 1) {
      const index = y * analysisSize + x;
      const laplacian =
        4 * gray[index] -
        gray[index - 1] -
        gray[index + 1] -
        gray[index - analysisSize] -
        gray[index + analysisSize];
      laplacianSum += laplacian;
      laplacianSq += laplacian * laplacian;
      laplacianCount += 1;
    }
  }

  const laplacianMean = laplacianSum / Math.max(1, laplacianCount);
  const laplacianVariance =
    laplacianSq / Math.max(1, laplacianCount) -
    laplacianMean * laplacianMean;
  const sharpness = clamp((Math.log1p(laplacianVariance) - 3.6) / 3.1);
  const exposure = clamp(1 - clipped / gray.length / 0.22);
  const resolution = clamp(
    Math.min(file.size / 300_000, Math.min(sourceWidth, sourceHeight) / 1200),
  );

  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;
  const border = 24;
  for (let y = 0; y < analysisSize; y += 1) {
    for (let x = 0; x < analysisSize; x += 1) {
      if (
        x < border ||
        y < border ||
        x >= analysisSize - border ||
        y >= analysisSize - border
      ) {
        const offset = (y * analysisSize + x) * 4;
        borderR += pixels[offset];
        borderG += pixels[offset + 1];
        borderB += pixels[offset + 2];
        borderCount += 1;
      }
    }
  }
  borderR /= borderCount;
  borderG /= borderCount;
  borderB /= borderCount;
  const borderLum = 0.2126 * borderR + 0.7152 * borderG + 0.0722 * borderB;

  const contrastScores: number[] = [];
  const scoreMap = new Float32Array(gray.length);
  for (let y = 0; y < analysisSize; y += 1) {
    for (let x = 0; x < analysisSize; x += 1) {
      const index = y * analysisSize + x;
      const offset = index * 4;
      const colorDistance = Math.sqrt(
        (pixels[offset] - borderR) ** 2 +
          (pixels[offset + 1] - borderG) ** 2 +
          (pixels[offset + 2] - borderB) ** 2,
      );
      const darkDelta = Math.max(0, borderLum - gray[index]);
      const score = darkDelta + colorDistance * 0.38;
      scoreMap[index] = score;
      if (
        x > analysisSize * 0.1 &&
        x < analysisSize * 0.9 &&
        y > analysisSize * 0.1 &&
        y < analysisSize * 0.9
      ) {
        contrastScores.push(score);
      }
    }
  }

  const threshold = Math.max(18, percentile(contrastScores, 0.86));
  const mask = new Uint8Array(gray.length);
  for (let y = 5; y < analysisSize - 5; y += 1) {
    for (let x = 5; x < analysisSize - 5; x += 1) {
      const index = y * analysisSize + x;
      mask[index] = scoreMap[index] >= threshold ? 1 : 0;
    }
  }

  const component = largestComponent(mask, analysisSize, analysisSize);
  const selected = new Uint8Array(mask.length);
  component.forEach((index) => {
    selected[index] = 1;
  });

  const area = Math.max(1, component.length);
  let sumX = 0;
  let sumY = 0;
  let perimeter = 0;
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let meanLum = 0;
  let scoreInside = 0;
  let minX = analysisSize;
  let minY = analysisSize;
  let maxX = 0;
  let maxY = 0;

  for (const index of component) {
    const x = index % analysisSize;
    const y = Math.floor(index / analysisSize);
    const offset = index * 4;
    sumX += x;
    sumY += y;
    meanR += pixels[offset];
    meanG += pixels[offset + 1];
    meanB += pixels[offset + 2];
    meanLum += gray[index];
    scoreInside += scoreMap[index];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (
      x === 0 ||
      y === 0 ||
      x === analysisSize - 1 ||
      y === analysisSize - 1 ||
      !selected[index - 1] ||
      !selected[index + 1] ||
      !selected[index - analysisSize] ||
      !selected[index + analysisSize]
    ) {
      perimeter += 1;
    }
  }

  const centerX = sumX / area;
  const centerY = sumY / area;
  meanR /= area;
  meanG /= area;
  meanB /= area;
  meanLum /= area;
  scoreInside /= area;

  let colorVariance = 0;
  let mismatchX = 0;
  let mismatchY = 0;
  for (const index of component) {
    const x = index % analysisSize;
    const y = Math.floor(index / analysisSize);
    const offset = index * 4;
    colorVariance +=
      (pixels[offset] - meanR) ** 2 +
      (pixels[offset + 1] - meanG) ** 2 +
      (pixels[offset + 2] - meanB) ** 2;

    const mirrorX = Math.round(centerX * 2 - x);
    const mirrorY = Math.round(centerY * 2 - y);
    if (
      mirrorX < 0 ||
      mirrorX >= analysisSize ||
      !selected[y * analysisSize + mirrorX]
    ) {
      mismatchX += 1;
    }
    if (
      mirrorY < 0 ||
      mirrorY >= analysisSize ||
      !selected[mirrorY * analysisSize + x]
    ) {
      mismatchY += 1;
    }
  }

  const areaFraction = area / gray.length;
  const diameterFraction =
    (2 * Math.sqrt(area / Math.PI)) / analysisSize;
  const centerOffset =
    Math.hypot(centerX - analysisSize / 2, centerY - analysisSize / 2) /
    (analysisSize * 0.707);
  const plausibleArea = clamp(
    Math.min(areaFraction / 0.015, (0.36 - areaFraction) / 0.18),
  );
  const centerScore = clamp(1 - centerOffset / 0.65);
  const contrastConfidence = clamp((scoreInside - threshold + 15) / 55);
  const segmentationConfidence =
    plausibleArea * 0.38 + centerScore * 0.26 + contrastConfidence * 0.36;

  const borderIrregularity = clamp(
    ((perimeter * perimeter) / (4 * Math.PI * area) - 1) / 4,
  );
  const asymmetry = clamp((mismatchX + mismatchY) / (2 * area));
  const colorVariation = clamp(
    Math.sqrt(colorVariance / (area * 3)) / 72,
  );
  const darknessContrast = clamp((borderLum - meanLum) / 120);

  const sourceResolution = clamp(
    Math.min(file.size / 450_000, Math.min(sourceWidth, sourceHeight) / 1200),
  );
  const qualityScore =
    sharpness * 0.48 + exposure * 0.25 + sourceResolution * 0.27;
  const qualityStatus =
    qualityScore >= 0.68 &&
    sharpness >= 0.65 &&
    segmentationConfidence >= 0.55 &&
    centerOffset <= 0.3
      ? "good"
      : qualityScore >= 0.42 && segmentationConfidence >= 0.25
        ? "review"
        : "retake";

  const gridSize = 16;
  const shapeBits = new Uint8Array(gridSize * gridSize);
  const lesionWidth = Math.max(1, maxX - minX + 1);
  const lesionHeight = Math.max(1, maxY - minY + 1);
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      const sampleX = Math.min(
        analysisSize - 1,
        Math.round(
          minX + ((gridX + 0.5) / gridSize) * Math.max(0, lesionWidth - 1),
        ),
      );
      const sampleY = Math.min(
        analysisSize - 1,
        Math.round(
          minY + ((gridY + 0.5) / gridSize) * Math.max(0, lesionHeight - 1),
        ),
      );
      shapeBits[gridY * gridSize + gridX] =
        selected[sampleY * analysisSize + sampleX];
    }
  }

  const darknessHistogram = new Array<number>(8).fill(0);
  for (const index of component) {
    const relativeDarkness = clamp(
      (borderLum - gray[index]) / Math.max(40, borderLum),
    );
    const bin = Math.min(
      darknessHistogram.length - 1,
      Math.floor(relativeDarkness * darknessHistogram.length),
    );
    darknessHistogram[bin] += 1;
  }
  for (let index = 0; index < darknessHistogram.length; index += 1) {
    darknessHistogram[index] /= area;
  }

  return {
    version: 2,
    source: {
      width: sourceWidth,
      height: sourceHeight,
    },
    quality: {
      sharpness: toScore(sharpness),
      exposure: toScore(exposure),
      resolution: toScore(resolution),
      status: qualityStatus,
    },
    segmentation: {
      confidence: toScore(segmentationConfidence),
      areaFraction,
      diameterFraction,
      centerOffset,
    },
    features: {
      asymmetry,
      borderIrregularity,
      colorVariation,
      darknessContrast,
    },
    appearance: {
      shapeGrid: serializeBits(shapeBits),
      darknessHistogram,
      relativeColor: [
        clamp((borderR - meanR) / 180),
        clamp((borderG - meanG) / 180),
        clamp((borderB - meanB) / 180),
      ],
    },
  };
}

export function compareAnalyses(
  previous: AnalysisResult,
  current: AnalysisResult,
  previousSizeMm?: number,
  currentSizeMm?: number,
  daysBetweenPhotos?: number,
): ChangeResult {
  const mode = daysBetweenPhotos === 0 ? "same-day-retake" : "follow-up";
  let identity: ChangeResult["identity"] = "uncertain";
  let identityScore: number | undefined;
  if (previous.appearance && current.appearance) {
    const shape = shapeDistance(
      previous.appearance.shapeGrid,
      current.appearance.shapeGrid,
    );
    const histogram = histogramDistance(
      previous.appearance.darknessHistogram,
      current.appearance.darknessHistogram,
    );
    const relativeColor =
      previous.appearance.relativeColor.reduce(
        (sum, value, index) =>
          sum + Math.abs(value - current.appearance!.relativeColor[index]),
        0,
      ) / 3;
    const rawIdentityScore = clamp(
      shape * 0.65 + histogram * 0.2 + relativeColor * 0.15,
    );
    identity =
      rawIdentityScore >= 0.34
        ? "different"
        : rawIdentityScore >= 0.24
          ? "uncertain"
          : "same";
    identityScore = clamp((rawIdentityScore - 0.12) / 0.4);
  }

  const featureDelta = (key: keyof AnalysisResult["features"], scale: number) =>
    clamp(
      Math.abs(previous.features[key] - current.features[key]) / scale,
    );

  const factors = [
    {
      key: "shape",
      label: "Shape asymmetry",
      value: featureDelta("asymmetry", 0.24),
    },
    {
      key: "border",
      label: "Border",
      value: featureDelta("borderIrregularity", 0.2),
    },
    {
      key: "color",
      label: "Color variation",
      value: featureDelta("colorVariation", 0.22),
    },
    {
      key: "contrast",
      label: "Pigment contrast",
      value: featureDelta("darknessContrast", 0.28),
    },
  ];

  if (previousSizeMm && currentSizeMm) {
    factors.unshift({
      key: "size",
      label: "Reported size",
      value: clamp(
        Math.abs(currentSizeMm - previousSizeMm) /
          Math.max(0.5, previousSizeMm * 0.25),
      ),
    });
  }

  const weights = factors.map((factor) =>
    factor.key === "size" ? 1.35 : factor.key === "color" ? 1.1 : 1,
  );
  const score =
    factors.reduce(
      (sum, factor, index) => sum + factor.value * weights[index],
      0,
    ) / weights.reduce((sum, weight) => sum + weight, 0);

  const qualityFloor = Math.min(
    previous.quality.sharpness,
    current.quality.sharpness,
    previous.segmentation.confidence,
    current.segmentation.confidence,
  );
  const scaleRatio =
    Math.max(
      previous.segmentation.diameterFraction,
      current.segmentation.diameterFraction,
    ) /
    Math.max(
      0.001,
      Math.min(
        previous.segmentation.diameterFraction,
        current.segmentation.diameterFraction,
      ),
    );
  const captureIssues: string[] = [];
  if (Math.min(previous.quality.sharpness, current.quality.sharpness) < 65) {
    captureIssues.push("one photo is not sharp enough");
  }
  if (
    Math.min(
      previous.segmentation.confidence,
      current.segmentation.confidence,
    ) < 55
  ) {
    captureIssues.push("spot detection is not stable enough");
  }
  if (scaleRatio > 1.28) {
    captureIssues.push("camera distance or crop changed");
  }
  if (
    Math.max(
      previous.segmentation.centerOffset,
      current.segmentation.centerOffset,
    ) > 0.3 ||
    Math.abs(
      previous.segmentation.centerOffset - current.segmentation.centerOffset,
    ) > 0.16
  ) {
    captureIssues.push("the spot is framed differently");
  }
  const captureLimited =
    captureIssues.length > 0 ||
    previous.quality.status !== "good" ||
    current.quality.status !== "good";
  const reliability =
    mode === "follow-up" &&
    identity === "same" &&
    qualityFloor >= 55 &&
    previous.quality.status === "good" &&
    current.quality.status === "good" &&
    captureIssues.length === 0
      ? "good"
      : "low";

  const level =
    mode === "same-day-retake"
      ? "stable"
      : identity === "different"
      ? "substantial"
      : score < 0.24
        ? "stable"
        : score < 0.5
          ? "noticeable"
          : "substantial";
  const message =
    mode === "same-day-retake"
      ? "These photos were taken on the same day. Any difference is treated as capture variation, not biological change. Keep the sharper, better-centered image as the baseline and repeat later under matched conditions."
      : captureLimited
        ? `The photos are not comparable enough${
            captureIssues.length ? `: ${captureIssues.join(", ")}` : ""
          }. Retake the photo using the same light, distance and camera position.`
      : identity === "different"
      ? "These photos likely show different moles: their shape and internal pattern do not match. Change tracking has stopped. Move the latest photo to a separate record."
      : identity === "uncertain"
        ? "The system could not confirm that both photos show the same mole. Retake the photo at the same distance, angle and lighting."
      : level === "stable"
        ? "No significant visual change was measured between the two latest photos. This does not rule out medical changes."
        : level === "noticeable"
          ? "Measurable visual differences were found. Check that both photos were captured consistently and consider an in-person professional assessment."
          : "Significant visual differences were found. Do not delay professional assessment, especially if the spot is growing, bleeding or causing new symptoms.";

  return {
    score,
    level,
    reliability,
    mode,
    identity,
    identityScore,
    captureIssues,
    message,
    factors,
  };
}

export function assessSingleImage(
  analysis: AnalysisResult,
  sizeMm?: number,
): SingleImageAssessment {
  if (
    analysis.quality.status !== "good" ||
    analysis.quality.sharpness < 65 ||
    analysis.segmentation.confidence < 55 ||
    analysis.segmentation.centerOffset > 0.3
  ) {
    return {
      level: "retake",
      headline: "This photo is not reliable enough",
      message:
        "The photo is not consistent enough for shape or border measurements. Retake it in even light, center the spot inside the guide, hold the camera parallel to the skin and avoid glare or digital zoom.",
      action: "Retake the photo",
      flaggedCount: 0,
      factors: [
        {
          code: "A",
          label: "Asymmetry",
          state: "unknown",
          detail: "a better photo is needed",
        },
        {
          code: "B",
          label: "Border",
          state: "unknown",
          detail: "a better photo is needed",
        },
        {
          code: "C",
          label: "Color",
          state: "unknown",
          detail: "a better photo is needed",
        },
        {
          code: "D",
          label: "Diameter",
          state: sizeMm ? "clear" : "unknown",
          detail: sizeMm ? `${sizeMm} mm entered manually` : "size not provided",
        },
        {
          code: "E",
          label: "Evolution",
          state: "unknown",
          detail: "available after a follow-up photo",
        },
      ],
    };
  }

  const asymmetry = clamp(analysis.features.asymmetry / 0.45);
  const border = clamp(analysis.features.borderIrregularity / 0.7);
  const color = clamp(analysis.features.colorVariation / 0.35);
  const diameter = sizeMm ? clamp((sizeMm - 3) / 5) : undefined;
  const threshold = 0.72;

  const factors: SingleImageAssessment["factors"] = [
    {
      code: "A",
      label: "Asymmetry",
      value: asymmetry,
      state: asymmetry >= threshold ? "attention" : "clear",
      detail:
        asymmetry >= threshold
          ? "higher asymmetry measurement in this photo"
          : "lower asymmetry measurement in this photo",
    },
    {
      code: "B",
      label: "Border",
      value: border,
      state: border >= threshold ? "attention" : "clear",
      detail:
        border >= threshold
          ? "higher edge-complexity measurement; sensitive to focus and shadow"
          : "lower edge-complexity measurement in this photo",
    },
    {
      code: "C",
      label: "Color",
      value: color,
      state: color >= threshold ? "attention" : "clear",
      detail:
        color >= threshold
          ? "higher color-variation measurement; sensitive to lighting"
          : "lower color-variation measurement in this photo",
    },
    {
      code: "D",
      label: "Diameter",
      value: diameter,
      state:
        diameter === undefined
          ? "unknown"
          : sizeMm! >= 6
            ? "attention"
            : "clear",
      detail:
        diameter === undefined
          ? "enter a measurement taken beside a ruler"
          : sizeMm! >= 6
            ? `${sizeMm} mm — include this in an in-person assessment`
            : `${sizeMm} mm entered manually`,
    },
    {
      code: "E",
      label: "Evolution",
      state: "unknown",
      detail: "available after a follow-up photo",
    },
  ];

  const flaggedCount = factors.filter(
    (factor) => factor.state === "attention",
  ).length;
  const level = flaggedCount >= 3 ? "attention" : "baseline";
  const elevatedLabels = factors
    .filter((factor) => factor.state === "attention")
    .map((factor) => factor.label);

  const headline =
    flaggedCount === 0
      ? "Photo baseline measured"
      : flaggedCount === 1
        ? "One photo measurement is higher"
        : flaggedCount === 2
          ? "Two photo measurements are higher"
          : "Several photo measurements are higher";

  const message =
    flaggedCount === 0
      ? "The measurable shape, border and color values were lower on this photo-only scale. This does not show that a spot is benign; it gives you a baseline for a later comparison. Photo measurements are sensitive to light, focus and camera angle."
      : `This image produced higher photo-only measurements for ${elevatedLabels.join(
          " and ",
        )}. Photo measurements are sensitive to light, focus and camera angle, so use them as a baseline rather than a diagnosis.`;

  return {
    level,
    flaggedCount,
    headline,
    message,
    action: "Save this baseline and repeat later",
    factors,
  };
}

export function formatPercent(value: number) {
  return `${Math.max(3, Math.round(clamp(value) * 100))}%`;
}
