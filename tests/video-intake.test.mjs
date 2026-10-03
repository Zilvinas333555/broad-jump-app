// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntake } from "../video-intake.js";

const good = { readyState: 4, errorCode: null, duration: 3, videoWidth: 1280, videoHeight: 720 };

test("normal landscape video passes", () => {
  const r = classifyIntake(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.info.orientation, "landscape");
});

test("portrait video is detected as portrait", () => {
  const r = classifyIntake({ ...good, videoWidth: 1080, videoHeight: 1920 });
  assert.equal(r.ok, true);
  assert.equal(r.info.orientation, "portrait");
});

test("square video is detected as square", () => {
  assert.equal(classifyIntake({ ...good, videoWidth: 800, videoHeight: 800 }).info.orientation, "square");
});

test("decode error blocks", () => {
  const r = classifyIntake({ ...good, errorCode: 3 });
  assert.equal(r.ok, false);
  assert.match(r.blockers[0], /could not be decoded/);
});

test("corrupt file reports only the decode error", () => {
  const r = classifyIntake({ readyState: 0, errorCode: 4, duration: NaN, videoWidth: 0, videoHeight: 0 });
  assert.equal(r.blockers.length, 1);
  assert.match(r.blockers[0], /could not be decoded/);
});

test("no metadata blocks", () => {
  const r = classifyIntake({ ...good, readyState: 0, duration: NaN });
  assert.equal(r.ok, false);
});

test("missing video track (audio-only) blocks", () => {
  const r = classifyIntake({ ...good, videoWidth: 0, videoHeight: 0 });
  assert.equal(r.ok, false);
  assert.match(r.blockers.join(" "), /No usable video track/);
  assert.equal(r.info.orientation, "unknown");
});

test("under 1 second blocks", () => {
  const r = classifyIntake({ ...good, duration: 0.5 });
  assert.equal(r.ok, false);
  assert.match(r.blockers[0], /0\.50 s long/);
});

test("exactly 1 second passes", () => {
  assert.equal(classifyIntake({ ...good, duration: 1 }).ok, true);
});

test("long video is not blocked", () => {
  assert.equal(classifyIntake({ ...good, duration: 600 }).ok, true);
});
