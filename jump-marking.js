// Stage 7-8: mark takeoff (front-most toe) and landing (rear-most heel), then show the computed
// distance. Frame navigation reuses the existing player controls (play/pause, ±1, ±5, timeline);
// this module only owns the two markers, placed through the shared aimer (marker-pair.js).
import { computeJumpDistanceM } from "./jumps.js";

const COLORS = { takeoff: "#4dd48a", landing: "#ff6b9d" };
const LABELS = { takeoff: "T", landing: "L" };

// aimer: from marker-pair.js, shared with calibration.js.
// getCalibration(): returns the saved calibration, or null.
// goToFrame(n): seeks the player to a frame (used when opening an existing jump for editing).
// Returns { open(existingJump|null), close(), isOpen(), onSave(fn) }.
export function mountJumpMarking({ aimer, els, getCalibration, goToFrame }) {
  let draft = null; // { id: existing id or null, points: { takeoff, landing }, mode }
  let onSave = () => {};

  function updateStep() {
    if (!draft) return;
    const { points } = draft;
    if (!points.takeoff) {
      els.step.textContent = "Navigate to the takeoff frame, then tap the front-most toe";
    } else if (!points.landing) {
      els.step.textContent = "Navigate to the landing frame, then tap the rear-most heel";
    } else {
      els.step.textContent = "Adjust a marker if needed, then save";
    }
    els.setTakeoff.classList.toggle("selected", draft.mode === "takeoff");
    els.setLanding.classList.toggle("selected", draft.mode === "landing");
    els.save.disabled = !(points.takeoff && points.landing);

    const calibration = getCalibration();
    if (points.takeoff && points.landing && calibration) {
      const m = computeJumpDistanceM({ calibration, takeoff: points.takeoff, landing: points.landing });
      els.result.textContent = m == null ? "" : `${m.toFixed(2)} m`;
      els.result.className = "readout";
    } else {
      els.result.textContent = "";
    }
  }

  function activateScene() {
    aimer.setScene({
      keyA: "takeoff",
      keyB: "landing",
      colors: COLORS,
      labels: LABELS,
      initialPoints: draft.points,
      onPlace: (key, point, allPoints) => {
        draft.points.takeoff = allPoints.takeoff;
        draft.points.landing = allPoints.landing;
        if (key === "takeoff") draft.mode = "landing";
        updateStep();
      },
      onRejectOutside: () => { els.step.textContent = "Tap on the picture, not the black border"; },
    });
    aimer.setMode(draft.mode);
  }

  function open(existingJump) {
    draft = existingJump
      ? { id: existingJump.id, points: { takeoff: existingJump.takeoff, landing: existingJump.landing }, mode: "takeoff" }
      : { id: null, points: { takeoff: null, landing: null }, mode: "takeoff" };
    els.card.hidden = false;
    activateScene();
    // Jump to the stored takeoff frame when editing, so the marker is visible right away.
    if (existingJump) goToFrame(existingJump.takeoff.frame);
    updateStep();
  }

  function close() {
    if (!draft) return; // nothing open: must not clobber whatever scene IS active (e.g. calibration)
    draft = null;
    aimer.clearScene();
    els.card.hidden = true;
    els.result.textContent = "";
  }

  els.setTakeoff.addEventListener("click", () => {
    if (!draft) return;
    draft.mode = "takeoff";
    aimer.setMode("takeoff");
    updateStep();
  });
  els.setLanding.addEventListener("click", () => {
    if (!draft) return;
    draft.mode = "landing";
    aimer.setMode("landing");
    updateStep();
  });
  els.cancel.addEventListener("click", close);
  els.save.addEventListener("click", () => {
    if (!draft || !draft.points.takeoff || !draft.points.landing) return;
    const calibration = getCalibration();
    const distanceM = computeJumpDistanceM({ calibration, takeoff: draft.points.takeoff, landing: draft.points.landing });
    const result = { id: draft.id, takeoff: draft.points.takeoff, landing: draft.points.landing, distanceM };
    // Close first: the caller's onSave handler may check isOpen() (e.g. to re-enable "+ Add Jump"),
    // and that must already reflect "closed" by the time it runs.
    close();
    onSave(result);
  });

  return {
    open,
    close,
    isOpen: () => draft !== null,
    onSave(fn) { onSave = fn; },
  };
}
