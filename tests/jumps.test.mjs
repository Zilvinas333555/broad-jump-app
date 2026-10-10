// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeJumpDistanceM, summarizeJumps } from "../jumps.js";
import { computeCalibration } from "../calibration.js";

// A horizontal calibration line, 1 cm per pixel (580 px = 580 cm).
const horizontalCal = computeCalibration({ a: { x: 0, y: 500 }, b: { x: 580, y: 500 }, realCm: 580 });

test("horizontal jump under a horizontal calibration: plain pixel distance", () => {
  const m = computeJumpDistanceM({
    calibration: horizontalCal,
    takeoff: { x: 100, y: 480 },
    landing: { x: 383, y: 480 }, // 283 px -> 283 cm -> 2.83 m
  });
  assert.ok(Math.abs(m - 2.83) < 1e-9);
});

test("distance is the same regardless of jump direction (left-to-right or right-to-left)", () => {
  const forward = computeJumpDistanceM({ calibration: horizontalCal, takeoff: { x: 100, y: 480 }, landing: { x: 383, y: 480 } });
  const backward = computeJumpDistanceM({ calibration: horizontalCal, takeoff: { x: 383, y: 480 }, landing: { x: 100, y: 480 } });
  assert.equal(forward, backward);
});

test("vertical offset between takeoff and landing (athlete not at the same height) does not add to the distance", () => {
  const m = computeJumpDistanceM({
    calibration: horizontalCal,
    takeoff: { x: 100, y: 480 },
    landing: { x: 383, y: 650 }, // 170 px of vertical noise ignored; only the horizontal component counts
  });
  assert.ok(Math.abs(m - 2.83) < 1e-9);
});

test("a tilted calibration line: the jump is projected onto its direction, not measured as raw dx", () => {
  // Calibration line at a 3-4-5 slope: 300 px horizontal, 400 px vertical, 500 px long, 500 cm real -> 1 cm/px along the line.
  const tiltedCal = computeCalibration({ a: { x: 0, y: 0 }, b: { x: 300, y: 400 }, realCm: 500 });
  // A jump exactly along that same direction, scaled by 2: length 1000 px along the line -> 1000 cm -> 10 m.
  const m = computeJumpDistanceM({ calibration: tiltedCal, takeoff: { x: 0, y: 0 }, landing: { x: 600, y: 800 } });
  assert.ok(Math.abs(m - 10) < 1e-9);
});

test("a jump purely perpendicular to the calibration line measures near zero", () => {
  const m = computeJumpDistanceM({
    calibration: horizontalCal, // horizontal line, so its perpendicular is vertical
    takeoff: { x: 200, y: 100 },
    landing: { x: 200, y: 400 },
  });
  assert.ok(Math.abs(m) < 1e-9);
});

test("missing calibration or markers returns null, not a wrong number", () => {
  assert.equal(computeJumpDistanceM({ calibration: null, takeoff: { x: 0, y: 0 }, landing: { x: 1, y: 1 } }), null);
  assert.equal(computeJumpDistanceM({ calibration: horizontalCal, takeoff: null, landing: { x: 1, y: 1 } }), null);
  assert.equal(computeJumpDistanceM({ calibration: horizontalCal, takeoff: { x: 0, y: 0 }, landing: null }), null);
});

test("summarizeJumps: best, average and count", () => {
  const jumps = [{ distanceM: 2.71 }, { distanceM: 2.83 }, { distanceM: 2.76 }, { distanceM: 2.80 }];
  const s = summarizeJumps(jumps);
  assert.equal(s.count, 4);
  assert.ok(Math.abs(s.best - 2.83) < 1e-9);
  assert.ok(Math.abs(s.average - (2.71 + 2.83 + 2.76 + 2.80) / 4) < 1e-9);
});

test("summarizeJumps: empty list", () => {
  const s = summarizeJumps([]);
  assert.deepEqual(s, { count: 0, best: null, average: null });
});

test("summarizeJumps: jumps without a computed distance are not counted towards best/average", () => {
  const s = summarizeJumps([{ distanceM: 2.5 }, { distanceM: null }, { distanceM: undefined }]);
  assert.equal(s.count, 3);
  assert.equal(s.best, 2.5);
  assert.equal(s.average, 2.5);
});
