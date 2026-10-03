// Stage 5: footage quality checks.
// Two parts:
//   buildChecks()    pure: turns measurements into a list of OK / WARN / BLOCK results.
//   sampleFootage()  browser: seeks to evenly spaced frames and measures them.
// Warnings never stop the user from continuing. Only BLOCK does, and only for footage
// that cannot be navigated or analysed. Thresholds live in quality-metrics.js.
import { THRESHOLDS, laplacianVariance, exposureStats, halve, globalShift, median } from "./quality-metrics.js";
import { timeOfFrame } from "./frame-math.js";

export const SAMPLE_COUNT = 8;
const SAMPLE_WIDTH = 320;   // all sharpness and exposure numbers are measured at this width
const SEEK_TIMEOUT_MS = 6000;   // phones can take a few seconds for a 4K HEVC seek

// samples: [{ seekOk, sharpness, darkPct, brightPct, motionGray }]
export function buildChecks({ info, timing, samples }) {
  const checks = [];

  // Resolution: the shorter side matters for a side-on view of the whole body.
  if (info.width && info.height) {
    const short = Math.min(info.width, info.height);
    checks.push({
      id: "resolution",
      label: "Resolution",
      status: short < THRESHOLDS.minShortSidePx ? "warn" : "ok",
      detail: `${info.width} × ${info.height}` +
        (short < THRESHOLDS.minShortSidePx ? ` (shorter side below ${THRESHOLDS.minShortSidePx} px)` : ""),
    });
  }

  // FPS: frame timing comes from the container (mp4-timing.js).
  if (!timing || !timing.fps) {
    checks.push({ id: "fps", label: "FPS", status: "warn", detail: "Could not be read from this file" });
  } else {
    const fpsText = timing.fps.toFixed(2) + " fps" + (timing.method === "variable" ? " (variable frame rate)" : "");
    checks.push({
      id: "fps",
      label: "FPS",
      status: timing.fps < THRESHOLDS.minFps ? "warn" : "ok",
      detail: fpsText + (timing.fps < THRESHOLDS.minFps ? ` (below ${THRESHOLDS.minFps})` : ""),
    });
  }

  // Duration: long videos are allowed, just less efficient to navigate.
  const longVideo = info.durationS > THRESHOLDS.maxDurationS;
  checks.push({
    id: "duration",
    label: "Duration",
    status: longVideo ? "warn" : "ok",
    detail: `${info.durationS.toFixed(1)} s` + (longVideo ? " (longer than 5 minutes; still usable)" : ""),
  });

  // Frame navigation: BLOCK only when most seeks fail. A few slow seeks on a phone are a warning.
  const seekFailures = samples.filter((s) => !s.seekOk).length;
  const navBlocked = samples.length > 0 && seekFailures > samples.length / 2;
  checks.push({
    id: "navigation",
    label: "Frame navigation",
    status: navBlocked ? "block" : seekFailures > 0 ? "warn" : "ok",
    detail: navBlocked
      ? `Seeking failed on ${seekFailures} of ${samples.length} sample frames`
      : seekFailures > 0
        ? `${seekFailures} of ${samples.length} sample frames were slow to reach; checks used the rest`
        : `Seeking worked on all ${samples.length} sample frames`,
  });

  const measured = samples.filter((s) => s.seekOk);

  // Camera movement: background shift within each close-in-time pair of frames.
  // A pair that cannot be matched (the view changed too much) counts as moving.
  const pairs = measured.filter((s) => s.motionGrayNext);
  const magnitudes = pairs.map((s) => {
    const a = s.motionGray;
    const shift = globalShift(a.gray, s.motionGrayNext.gray, a.w, a.h, THRESHOLDS.motionSearchPx);
    const saturated = Math.abs(shift.dx) >= THRESHOLDS.motionSearchPx || Math.abs(shift.dy) >= THRESHOLDS.motionSearchPx;
    if (saturated || shift.mad > THRESHOLDS.motionMaxMad) return Infinity;
    return Math.hypot(shift.dx, shift.dy);
  });
  const medianShift = median(magnitudes);
  if (medianShift === null) {
    checks.push({ id: "motion", label: "Camera movement", status: "unknown", detail: "Not enough samples to check" });
  } else {
    const moving = medianShift > THRESHOLDS.motionPx;
    checks.push({
      id: "motion",
      label: "Camera movement",
      status: moving ? "warn" : "ok",
      detail: !moving
        ? "No significant background movement"
        : medianShift === Infinity
          ? "The background moved too far within a fraction of a second to measure; the camera may not be still"
          : `Background moved about ${medianShift.toFixed(1)} px within a fraction of a second; the camera may not be still`,
    });
  }

  // Sharpness: warn only if most samples are blurry, so one soft frame is not a problem.
  if (measured.length) {
    const blurry = measured.filter((s) => s.sharpness < THRESHOLDS.blurVariance).length;
    const blurryShare = blurry / measured.length;
    checks.push({
      id: "sharpness",
      label: "Image sharpness",
      status: blurryShare > THRESHOLDS.blurMajority ? "warn" : "ok",
      detail: `${blurry} of ${measured.length} sample frames look soft`,
    });

    // Exposure: a sample is bad if too many pixels are crushed to black or clipped to white.
    const bad = measured.filter((s) => s.darkPct > THRESHOLDS.darkPixelsPct || s.brightPct > THRESHOLDS.brightPixelsPct);
    const badShare = bad.length / measured.length;
    const tooDark = measured.filter((s) => s.darkPct > THRESHOLDS.darkPixelsPct).length;
    const tooBright = measured.filter((s) => s.brightPct > THRESHOLDS.brightPixelsPct).length;
    checks.push({
      id: "exposure",
      label: "Exposure",
      status: badShare > THRESHOLDS.exposureMajority ? "warn" : "ok",
      detail: badShare > THRESHOLDS.exposureMajority
        ? `${tooDark} samples too dark, ${tooBright} too bright (of ${measured.length})`
        : "Exposure looks usable",
    });
  }

  const blocked = checks.some((c) => c.status === "block");
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { checks, blocked, warnings };
}

// Seeks a video to a time and resolves true once the frame is ready, false on timeout.
function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) {
      resolve(true);
      return;
    }
    let timer = null;
    const done = (ok) => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    video.addEventListener("seeked", onSeeked);
    timer = setTimeout(() => done(false), SEEK_TIMEOUT_MS);
    video.currentTime = time;
  });
}

// Draws the current frame at SAMPLE_WIDTH and returns grayscale luma values.
function frameToGray(video, canvas, ctx) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const w = SAMPLE_WIDTH;
  const h = Math.round((SAMPLE_WIDTH * vh) / vw);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) | 0;
  }
  return { gray, w, h };
}

// Samples evenly spaced frames using the player's own <video> element. A hidden second element
// was unreliable on iPhone, where seeks on off-screen video did not complete.
// The element's position is restored afterwards, so the player is not disturbed.
export async function sampleFootage(video, timing, onProgress = () => {}) {
  if (video.readyState < 2) {
    await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
  }
  const restoreTime = video.currentTime;
  video.pause();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const samples = [];

  for (let k = 0; k < SAMPLE_COUNT; k++) {
    onProgress(k, SAMPLE_COUNT);
    // With frame timing, sample by frame number. Without it, fall back to evenly spaced times.
    const target = timing
      ? timeOfFrame(Math.round(((k + 0.5) * timing.frameCount) / SAMPLE_COUNT), timing.times)
      : ((k + 0.5) / SAMPLE_COUNT) * video.duration;
    const seekOk = await seekTo(video, target);
    if (!seekOk) {
      samples.push({ seekOk: false });
      continue;
    }
    const { gray, w, h } = frameToGray(video, canvas, ctx);
    const { darkPct, brightPct } = exposureStats(gray);

    // Second frame a short time later: camera movement is measured within this pair,
    // because frames far apart in time differ by more than the search range.
    const nextTime = Math.min(target + THRESHOLDS.motionPairGapS, video.duration - 0.01);
    const nextOk = await seekTo(video, nextTime);
    const nextFrame = nextOk ? halve(frameToGray(video, canvas, ctx).gray, w, h) : null;

    samples.push({
      seekOk: true,
      sharpness: laplacianVariance(gray, w, h),
      darkPct,
      brightPct,
      motionGray: halve(gray, w, h),
      motionGrayNext: nextFrame,
    });
  }
  onProgress(SAMPLE_COUNT, SAMPLE_COUNT);

  video.currentTime = restoreTime;
  return samples;
}
