// Frame <-> time mapping built on the per-frame timestamps from mp4-timing.js.
// Frame numbers are 0-based and match ffmpeg's frame index in display order.
//
// Frame n is shown from times[n] until times[n + 1]. "Seeking to a frame" means
// seeking to the middle of that interval, so floating-point rounding can never land
// on the neighbouring frame.

// Index of the frame displayed at time t: the last frame whose start time is <= t.
export function frameAtTime(t, times) {
  let lo = 0;
  let hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Time to seek to in order to display frame n: the middle of its interval.
export function timeOfFrame(n, times) {
  const i = clampFrame(n, times.length);
  const end = i + 1 < times.length ? times[i + 1] : times[i] + (times[i] - times[i - 1] || 1 / 60);
  return (times[i] + end) / 2;
}

export function clampFrame(n, frameCount) {
  return Math.min(Math.max(0, n), frameCount - 1);
}
