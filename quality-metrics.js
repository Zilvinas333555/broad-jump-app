// Stage 5: pure image measurements used by the footage quality check.
// No DOM here, so every function is unit-tested with plain arrays.
// Inputs are grayscale images as Uint8Array/Uint8ClampedArray, row-major, w × h.

// All thresholds in one place. They are starting points, not validated values:
// tune them on real phone footage (see the Stage 5 test plan).
export const THRESHOLDS = {
  minFps: 24,                 // WARN below this
  minShortSidePx: 720,        // WARN if the shorter side is below this
  maxDurationS: 5 * 60,       // WARN above this (long videos are still allowed)
  blurVariance: 50,           // Laplacian variance below this counts as a blurry sample
  blurMajority: 0.5,          // WARN if more than this share of samples are blurry
  darkPixelsPct: 60,          // a sample is too dark if more than this % of pixels are very dark
  brightPixelsPct: 20,        // a sample is too bright if more than this % of pixels are clipped
  exposureMajority: 0.5,      // WARN if more than this share of samples are badly exposed
  motionPx: 1.5,              // WARN if the median background shift between samples exceeds this (at 160 px wide)
  motionSearchPx: 6,          // search range for the shift, in pixels at 160 px wide
  motionPairGapS: 0.1,        // second frame of each pair is this far after the first (short gaps keep shifts measurable)
  motionMaxMad: 25,           // a pair with a worse match than this (mean grey difference) cannot be measured: counts as moving
};

// Variance of the 3×3 Laplacian response over the image interior.
// Sharp edges give a large variance; blur flattens them towards zero.
export function laplacianVariance(gray, w, h) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// Share of pixels that are extremely dark (≤ 15) and extremely bright (≥ 240), as percentages.
export function exposureStats(gray) {
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= 15) dark++;
    else if (gray[i] >= 240) bright++;
  }
  const total = gray.length || 1;
  return { darkPct: (100 * dark) / total, brightPct: (100 * bright) / total };
}

// Halves the resolution by averaging 2×2 blocks. Used to make the motion search cheap.
export function halve(gray, w, h) {
  const w2 = Math.floor(w / 2);
  const h2 = Math.floor(h / 2);
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = (2 * y) * w + 2 * x;
      out[y * w2 + x] = (gray[i] + gray[i + 1] + gray[i + w] + gray[i + w + 1]) >> 2;
    }
  }
  return { gray: out, w: w2, h: h2 };
}

// Finds the global (whole-image) translation between two frames by brute-force search.
// Compares the mean absolute difference over a central region, which ignores the borders.
// Returns (dx, dy): how far the content of `next` has moved relative to `prev`, in pixels of this resolution.
// A static camera gives (0, 0); a panning or shaking camera gives a non-zero shift because the background moves.
// On periodic textures (a grid, a fence) several shifts match equally well; ties go to the smallest shift.
export function globalShift(prev, next, w, h, maxShift) {
  const margin = maxShift + 2;
  let best = { dx: 0, dy: 0, mad: Infinity };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let total = 0;
      let count = 0;
      for (let y = margin; y < h - margin; y++) {
        const rowPrev = y * w;
        const rowNext = (y + dy) * w + dx;
        for (let x = margin; x < w - margin; x++) {
          total += Math.abs(prev[rowPrev + x] - next[rowNext + x]);
          count++;
        }
      }
      const mad = count ? total / count : Infinity;
      const size = Math.abs(dx) + Math.abs(dy);
      const bestSize = Math.abs(best.dx) + Math.abs(best.dy);
      if (mad < best.mad || (mad === best.mad && size < bestSize)) best = { dx, dy, mad };
    }
  }
  return best;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
