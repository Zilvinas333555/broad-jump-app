// Pure geometry for placing points on a <video> shown with object-fit: contain, and for the
// press-and-hold magnifier. No DOM here, so it is unit-tested directly. Shared by calibration.js
// and jump-marking.js, which both let the user tap a precise point on the video picture.

// Where the video picture sits inside its on-screen box when shown with object-fit: contain.
// Returns the scale from video pixels to box pixels and the letterbox offsets.
export function contentRect(boxW, boxH, videoW, videoH) {
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale };
}

export function boxToVideo(rect, bx, by) {
  return { x: (bx - rect.x) / rect.scale, y: (by - rect.y) / rect.scale };
}

export function videoToBox(rect, vx, vy) {
  return { x: rect.x + vx * rect.scale, y: rect.y + vy * rect.scale };
}

export function insideContent(rect, bx, by) {
  return bx >= rect.x && bx <= rect.x + rect.w && by >= rect.y && by <= rect.y + rect.h;
}

// Magnifier (loupe): shown while a finger or mouse button is held down on the picture.
export const LOUPE_SIZE_PX = 120;   // on-screen diameter
export const LOUPE_ZOOM = 3;        // magnification
const LOUPE_LIFT_PX = 90;           // how far above the touch point the loupe sits, so the finger does not hide it

// The part of the video (in video pixels) that the loupe shows, centred on box point (bx, by).
export function loupeSource(rect, bx, by, size = LOUPE_SIZE_PX, zoom = LOUPE_ZOOM) {
  const spanBox = size / zoom;             // box pixels covered by the loupe
  const c = boxToVideo(rect, bx, by);
  const half = spanBox / 2 / rect.scale;   // the same span, converted to video pixels
  return { sx: c.x - half, sy: c.y - half, sw: 2 * half, sh: 2 * half };
}

// Top-left corner of the loupe inside the picture box. Above the finger when there is room, below otherwise.
export function loupePlacement(bx, by, boxW, boxH, size = LOUPE_SIZE_PX, lift = LOUPE_LIFT_PX) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const left = clamp(bx - size / 2, 0, boxW - size);
  const above = by - lift - size / 2;
  const top = above >= 0 ? above : by + lift - size / 2;
  return { left, top: clamp(top, 0, boxH - size) };
}
