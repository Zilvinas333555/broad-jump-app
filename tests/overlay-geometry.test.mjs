// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentRect, boxToVideo, videoToBox, insideContent,
  loupeSource, loupePlacement, LOUPE_SIZE_PX, LOUPE_ZOOM,
} from "../overlay-geometry.js";

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

test("loupe shows a region centred on the aim point, at the zoom factor", () => {
  // 1280x720 video in a 640x360 box: scale 0.5
  const rect = contentRect(640, 360, 1280, 720);
  const src = loupeSource(rect, 320, 180);            // aim at the centre of the picture
  assert.deepEqual([src.sx + src.sw / 2, src.sy + src.sh / 2], [640, 360]);
  // The loupe covers size/zoom box pixels, i.e. size/zoom / scale video pixels
  assert.ok(Math.abs(src.sw - (LOUPE_SIZE_PX / LOUPE_ZOOM) / 0.5) < 1e-9);
  assert.equal(src.sw, src.sh);
});

test("loupe sits above the finger when there is room", () => {
  const p = loupePlacement(200, 300, 400, 600);
  assert.ok(p.top + LOUPE_SIZE_PX <= 300, "loupe bottom above the finger");
  assert.ok(p.left >= 0 && p.left + LOUPE_SIZE_PX <= 400);
});

test("loupe moves below the finger near the top edge", () => {
  const p = loupePlacement(200, 40, 400, 600);
  assert.ok(p.top > 40, "loupe is below the finger instead of off the top");
  assert.ok(p.top >= 0);
});

test("loupe stays inside the picture box at the side edges", () => {
  assert.equal(loupePlacement(0, 300, 400, 600).left, 0);
  assert.equal(loupePlacement(400, 300, 400, 600).left, 400 - LOUPE_SIZE_PX);
});
