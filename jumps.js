// Stage 8: distance calculation, and the summary (count / best / average) for Stage 9's jump list.
// Pure: no DOM, so these are unit-tested directly.

// Distance between takeoff and landing, in the real world.
//
// We project the takeoff -> landing displacement onto the calibration line's own direction, rather
// than just taking the horizontal pixel difference. That way a calibration line that isn't perfectly
// horizontal in the frame (a slightly tilted camera) doesn't throw off the result. This does not
// correct for camera perspective — see the limitation note in calibration.js.
export function computeJumpDistanceM({ calibration, takeoff, landing }) {
  if (!calibration || !takeoff || !landing) return null;
  const { a, b, cmPerPx } = calibration;
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const ulen = Math.hypot(ux, uy);
  if (!ulen) return null;
  const unitX = ux / ulen;
  const unitY = uy / ulen;
  const dx = landing.x - takeoff.x;
  const dy = landing.y - takeoff.y;
  const alongPx = Math.abs(dx * unitX + dy * unitY);
  return (alongPx * cmPerPx) / 100;
}

export function summarizeJumps(jumps) {
  const distances = jumps.map((j) => j.distanceM).filter((d) => typeof d === "number" && Number.isFinite(d));
  return {
    count: jumps.length,
    best: distances.length ? Math.max(...distances) : null,
    average: distances.length ? distances.reduce((sum, d) => sum + d, 0) / distances.length : null,
  };
}
