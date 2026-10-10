// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCalibration, MIN_POINT_SEPARATION_PX } from "../calibration.js";

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
