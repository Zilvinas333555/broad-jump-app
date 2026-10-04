// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCalibration, contentRect, boxToVideo, videoToBox, insideContent, MIN_POINT_SEPARATION_PX } from "../calibration.js";

test("scale is real distance divided by pixel distance", () => {
  const r = computeCalibration({ a: { x: 100, y: 500 }, b: { x: 680, y: 500 }, realCm: 580 });
  assert.equal(r.ok, true);
  assert.equal(r.pxDistance, 580);
  assert.equal(r.cmPerPx, 1);
});

test("diagonal calibration uses the true pixel length", () => {
  const r = computeCalibration({ a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, realCm: 250 });
  assert.equal(r.pxDistance, 500);
  assert.equal(r.cmPerPx, 0.5);
});

test("known distances produce the expected scale", () => {
  for (const [px, cm] of [[200, 300], [412, 580], [1000, 250]]) {
    const r = computeCalibration({ a: { x: 0, y: 0 }, b: { x: px, y: 0 }, realCm: cm });
    assert.ok(Math.abs(r.cmPerPx * px - cm) < 1e-9, `${px} px at ${cm} cm`);
  }
});

test("rejects empty, zero, negative and non-numeric distances", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  for (const realCm of ["", 0, -5, "abc", undefined]) {
    assert.equal(computeCalibration({ a, b, realCm }).ok, false, `realCm=${JSON.stringify(realCm)}`);
  }
});

test("rejects points too close together", () => {
  const r = computeCalibration({ a: { x: 0, y: 0 }, b: { x: MIN_POINT_SEPARATION_PX - 1, y: 0 }, realCm: 100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /too close/);
});

test("content rect: letterboxed when the box is taller than the video", () => {
  // 1080x1920 portrait video shown in a 400x300 box: height-limited, bars left and right
  const r = contentRect(400, 300, 1080, 1920);
  assert.ok(Math.abs(r.scale - 300 / 1920) < 1e-12);
  assert.ok(Math.abs(r.x - (400 - r.w) / 2) < 1e-9);
  assert.equal(r.y, 0);
});

test("content rect: pillarboxed when the box is wider than the video", () => {
  const r = contentRect(600, 200, 1280, 720);
  assert.ok(Math.abs(r.scale - 200 / 720) < 1e-12);
  assert.equal(r.y, 0);
  assert.ok(r.x > 0);
});

test("tap → video pixel → tap round trip is exact", () => {
  const rect = contentRect(375, 500, 2160, 3840);
  for (const [bx, by] of [[10, 10], [187.5, 250], [300, 480]]) {
    if (!insideContent(rect, bx, by)) continue;
    const v = boxToVideo(rect, bx, by);
    const back = videoToBox(rect, v.x, v.y);
    assert.ok(Math.abs(back.x - bx) < 1e-9 && Math.abs(back.y - by) < 1e-9);
  }
});

test("taps on the black border are outside the picture", () => {
  const rect = contentRect(400, 300, 1080, 1920); // bars on left and right
  assert.equal(insideContent(rect, 2, 150), false);
  assert.equal(insideContent(rect, 200, 150), true);
});

test("a tap in the box maps to the expected video pixel", () => {
  // 1280x720 video in a 640x360 box: scale 0.5, no bars
  const rect = contentRect(640, 360, 1280, 720);
  assert.deepEqual(boxToVideo(rect, 320, 180), { x: 640, y: 360 });
});
