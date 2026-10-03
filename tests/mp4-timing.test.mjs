// Run with: npm test
// Checks the container parser against ffprobe's own per-frame timestamps.
// The real-footage test runs only when the file exists on this Mac.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, openAsBlob } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFrameTiming } from "../mp4-timing.js";
import { frameAtTime, timeOfFrame } from "../frame-math.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = (name) => join(here, "fixtures", name);

// ffprobe's presentation timestamps for every video frame, sorted, normalised to start at 0.
function ffprobeTimes(path) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "packet=pts_time", "-of", "csv=p=0", path,
  ], { encoding: "utf8" });
  const pts = out.trim().split("\n").filter(Boolean).map(Number).sort((a, b) => a - b);
  return pts.map((t) => t - pts[0]);
}

function assertMatchesFfprobe(timing, path) {
  const expected = ffprobeTimes(path);
  assert.equal(timing.frameCount, expected.length, "frame count");
  let worst = 0;
  for (let i = 0; i < expected.length; i++) {
    worst = Math.max(worst, Math.abs(timing.times[i] - expected[i]));
  }
  assert.ok(worst < 0.001, `worst timestamp error ${worst} s`);
}

test("30 fps clip: constant timing, every frame matches ffprobe", async () => {
  const path = fixturePath("landscape_720p_30fps.mp4");
  const timing = await readFrameTiming(await openAsBlob(path));
  assert.equal(timing.method, "constant");
  assert.ok(Math.abs(timing.fps - 30) < 0.01, `fps was ${timing.fps}`);
  assertMatchesFfprobe(timing, path);
});

test("60 fps portrait clip matches ffprobe", async () => {
  const path = fixturePath("portrait_1080p_60fps.mp4");
  assertMatchesFfprobe(await readFrameTiming(await openAsBlob(path)), path);
});

test("120 fps clip matches ffprobe", async () => {
  const path = fixturePath("landscape_120fps.mp4");
  assertMatchesFfprobe(await readFrameTiming(await openAsBlob(path)), path);
});

test("audio-only file returns null, not a guess", async () => {
  assert.equal(await readFrameTiming(await openAsBlob(fixturePath("audio_only.m4a"))), null);
});

test("corrupt file returns null", async () => {
  assert.equal(await readFrameTiming(await openAsBlob(fixturePath("corrupt.mp4"))), null);
});

test("frame <-> time round trip is exact for every frame", async () => {
  const timing = await readFrameTiming(await openAsBlob(fixturePath("landscape_720p_30fps.mp4")));
  for (let n = 0; n < timing.frameCount; n++) {
    assert.equal(frameAtTime(timeOfFrame(n, timing.times), timing.times), n, `frame ${n}`);
  }
});

const REAL = "/Users/zilvinask/Downloads/IMG_7154.MOV";
test("real iPhone HEVC MOV: every frame matches ffprobe", { skip: !existsSync(REAL) && "footage not on this Mac" }, async () => {
  const timing = await readFrameTiming(await openAsBlob(REAL));
  assert.equal(timing.frameCount, 3124);
  assert.equal(timing.method, "variable");
  assertMatchesFfprobe(timing, REAL);
});
