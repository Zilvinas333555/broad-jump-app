// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { laplacianVariance, exposureStats, halve, globalShift, median } from "../quality-metrics.js";
import { buildChecks } from "../footage-checks.js";

// Deterministic pseudo-random image so shift tests are repeatable.
function noiseImage(w, h, seed = 1) {
  const out = new Uint8Array(w * h);
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = s & 255;
  }
  return out;
}

function shiftImage(src, w, h, dx, dy) {
  // Returns the image moved by (dx, dy); edges are filled with the source's own values (only the interior is compared).
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - dx));
      const sy = Math.min(h - 1, Math.max(0, y - dy));
      out[y * w + x] = src[sy * w + sx];
    }
  }
  return out;
}

test("flat image has zero sharpness", () => {
  assert.equal(laplacianVariance(new Uint8Array(50 * 50).fill(128), 50, 50), 0);
});

test("sharp checkerboard is much sharper than a smooth gradient", () => {
  const w = 40, h = 40;
  const checker = new Uint8Array(w * h);
  const smooth = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    checker[y * w + x] = (x + y) % 2 ? 255 : 0;
    smooth[y * w + x] = Math.round((x / w) * 255);
  }
  assert.ok(laplacianVariance(checker, w, h) > 100 * laplacianVariance(smooth, w, h) + 1000);
});

test("exposure: all black is 100% dark, all white is 100% bright", () => {
  assert.equal(exposureStats(new Uint8Array(100).fill(0)).darkPct, 100);
  assert.equal(exposureStats(new Uint8Array(100).fill(255)).brightPct, 100);
  const mid = exposureStats(new Uint8Array(100).fill(128));
  assert.equal(mid.darkPct, 0);
  assert.equal(mid.brightPct, 0);
});

test("halve averages 2×2 blocks", () => {
  const img = new Uint8Array([0, 100, 0, 100, 0, 100, 0, 100]); // 4×2
  const half = halve(img, 4, 2);
  assert.equal(half.w, 2);
  assert.equal(half.h, 1);
  assert.deepEqual([...half.gray], [50, 50]);
});

test("global shift: static image gives (0, 0)", () => {
  const img = noiseImage(80, 60);
  assert.deepEqual(globalShift(img, img, 80, 60, 6), { dx: 0, dy: 0, mad: 0 });
});

test("global shift recovers a known translation", () => {
  const w = 80, h = 60;
  const base = noiseImage(w, h, 7);
  for (const [dx, dy] of [[3, -2], [-4, 1], [0, 5], [6, 6]]) {
    const moved = shiftImage(base, w, h, dx, dy);
    const s = globalShift(base, moved, w, h, 6);
    assert.deepEqual([s.dx, s.dy], [dx, dy], `shift (${dx}, ${dy})`);
  }
});

test("median handles odd, even and empty input", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

// --- buildChecks: decisions, using hand-made samples ---

const info = { width: 1080, height: 1920, durationS: 10 };
const timing = { fps: 60, method: "constant", frameCount: 600 };
const sharpGray = (seed) => {
  const w = 40, h = 40, g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = ((x + y) % 2 ? 200 : 60) + (seed % 3);
  return { gray: g, w: 20, h: 20 };
};
// Identical frames: a still camera. Sample index is unused but kept so call sites read naturally.
const goodSample = () => ({ seekOk: true, sharpness: 500, darkPct: 0, brightPct: 0, motionGray: sharpGray(0), motionGrayNext: sharpGray(0) });

function statusOf(result, id) {
  return result.checks.find((c) => c.id === id)?.status;
}

test("good footage: all checks OK, nothing blocked", () => {
  const samples = Array.from({ length: 8 }, (_, i) => goodSample(i));
  const r = buildChecks({ info, timing, samples });
  assert.equal(r.blocked, false);
  assert.equal(r.warnings, 0);
});

test("low-resolution and low-FPS warn", () => {
  const r = buildChecks({ info: { ...info, width: 640, height: 360 }, timing: { ...timing, fps: 15 }, samples: [goodSample(0)] });
  assert.equal(statusOf(r, "resolution"), "warn");
  assert.equal(statusOf(r, "fps"), "warn");
});

test("unknown FPS warns instead of guessing", () => {
  const r = buildChecks({ info, timing: null, samples: [goodSample(0)] });
  assert.equal(statusOf(r, "fps"), "warn");
});

test("video longer than 5 minutes warns but does not block", () => {
  const r = buildChecks({ info: { ...info, durationS: 400 }, timing, samples: [goodSample(0)] });
  assert.equal(statusOf(r, "duration"), "warn");
  assert.equal(r.blocked, false);
});

test("seeking failures on 2+ samples block", () => {
  const samples = [goodSample(0), { seekOk: false }, { seekOk: false }, goodSample(3)];
  const r = buildChecks({ info, timing, samples });
  assert.equal(statusOf(r, "navigation"), "block");
  assert.equal(r.blocked, true);
});

test("one soft sample does not warn; most soft samples do", () => {
  const oneSoft = [{ ...goodSample(0), sharpness: 1 }, goodSample(1), goodSample(2), goodSample(3)];
  assert.equal(statusOf(buildChecks({ info, timing, samples: oneSoft }), "sharpness"), "ok");
  const mostSoft = [0, 1, 2, 3].map((i) => ({ ...goodSample(i), sharpness: 1 }));
  assert.equal(statusOf(buildChecks({ info, timing, samples: mostSoft }), "sharpness"), "warn");
});

test("mostly underexposed samples warn", () => {
  const dark = [0, 1, 2, 3].map((i) => ({ ...goodSample(i), darkPct: 90 }));
  assert.equal(statusOf(buildChecks({ info, timing, samples: dark }), "exposure"), "warn");
});

test("camera movement warns when the background shifts within a sample pair", () => {
  // Noise, not a checkerboard: a checkerboard repeats every 2 px, so shifts of 1 and 3 look identical.
  const base = { gray: noiseImage(40, 40, 5), w: 40, h: 40 };
  const moved = { gray: shiftImage(base.gray, base.w, base.h, 3, 0), w: base.w, h: base.h };
  const moving = [0, 1, 2, 3].map(() => ({ ...goodSample(), motionGray: base, motionGrayNext: moved }));
  assert.equal(statusOf(buildChecks({ info, timing, samples: moving }), "motion"), "warn");
});

test("a pair the camera moved too far to match counts as moving", () => {
  const a = { gray: noiseImage(40, 40, 5), w: 40, h: 40 };
  const unrelated = { gray: noiseImage(40, 40, 99), w: 40, h: 40 };
  const samples = [0, 1, 2, 3].map(() => ({ ...goodSample(), motionGray: a, motionGrayNext: unrelated }));
  const r = buildChecks({ info, timing, samples });
  assert.equal(statusOf(r, "motion"), "warn");
});
