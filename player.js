// Stage 3: playback and frame controls on top of the native <video> element.
// Frame math lives in frame-math.js; the frame timestamps come from mp4-timing.js.
import { frameAtTime, timeOfFrame, clampFrame } from "./frame-math.js";

const el = {
  video: document.getElementById("player-video"),
  playBtn: document.getElementById("btn-play"),
  timeline: document.getElementById("timeline"),
  readout: document.getElementById("readout"),
  warning: document.getElementById("player-warning"),
  frameButtons: document.querySelectorAll("[data-step]"),
};

// The same element the checks use, so checks and playback go through one decoder.
export const playerVideo = el.video;

// Timing from mp4-timing.js, or null when it could not be read.
let timing = null;
// Frame we are seeking to. Taps during a seek build on this, not on currentTime,
// which can still be the old position while the seek is in progress.
let pendingFrame = null;

function currentFrame() {
  if (!timing) return null;
  return pendingFrame ?? frameAtTime(el.video.currentTime, timing.times);
}

function render() {
  const t = el.video.currentTime;
  const n = currentFrame();
  el.playBtn.textContent = el.video.paused ? "Play" : "Pause";
  el.timeline.max = Number.isFinite(el.video.duration) ? el.video.duration : 0;
  if (!el.video.seeking) el.timeline.value = t;

  const frameText = n == null
    ? "frame unknown"
    : `frame ${n} / ${timing.frameCount - 1}`;
  el.readout.textContent = `${t.toFixed(3)} s · ${frameText}`;
}

function pause() {
  if (!el.video.paused) el.video.pause();
}

function seekToFrame(n) {
  pendingFrame = clampFrame(n, timing.frameCount);
  el.video.currentTime = timeOfFrame(pendingFrame, timing.times);
  render();
}

// Frame number currently shown (or being sought to); used to record where a calibration point was placed.
export function currentFrameIndex() {
  return currentFrame();
}

export function stepFrames(delta) {
  if (!timing) return;
  pause();
  seekToFrame((currentFrame() ?? 0) + delta);
}

// Jumps to an absolute frame number. Used when opening a saved jump for editing, so its
// takeoff frame is visible right away.
export function goToFrame(n) {
  if (!timing) return;
  pause();
  seekToFrame(n);
}

export function togglePlay() {
  if (el.video.paused) {
    pendingFrame = null;
    el.video.play().catch(() => {});
  } else {
    pause();
  }
  render();
}

// Load a file's object URL with its frame timing (or null if timing is unknown).
export function loadPlayer(objectUrl, frameTiming) {
  timing = frameTiming;
  pendingFrame = null;
  el.video.src = objectUrl;
  el.video.load();

  const frameControlsOn = Boolean(timing);
  for (const btn of el.frameButtons) btn.disabled = !frameControlsOn;
  el.warning.hidden = frameControlsOn;
  el.warning.textContent = frameControlsOn
    ? ""
    : "Frame timing could not be read from this file. Frame buttons are disabled; the timeline still works.";
  render();
}

el.video.addEventListener("loadedmetadata", render);
el.video.addEventListener("timeupdate", render);
el.video.addEventListener("play", render);
el.video.addEventListener("pause", render);
el.video.addEventListener("seeked", () => {
  pendingFrame = null;
  render();
});

el.playBtn.addEventListener("click", togglePlay);

el.timeline.addEventListener("input", () => {
  pause();
  pendingFrame = null;
  el.video.currentTime = Number(el.timeline.value);
  render();
});

for (const btn of el.frameButtons) {
  btn.addEventListener("click", () => stepFrames(Number(btn.dataset.step)));
}
