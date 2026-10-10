// Stage 6: two-point floor calibration.
// The user taps two points on the same floor plane whose real distance is known, then enters that distance.
//   scale = real cm / pixel distance between the two points
// V1 limitation: simple scaling only. No perspective correction, so the result is less accurate when the
// camera is angled or the calibration points are at a different depth from the jump.
//
// computeCalibration() is pure and unit-tested. mountCalibration() is the DOM part: it places points
// through the shared aimer (marker-pair.js), the same one jump-marking.js uses for takeoff/landing.

export const MIN_POINT_SEPARATION_PX = 20;

// a, b: { x, y } in video pixels. realCm: the distance the user typed.
export function computeCalibration({ a, b, realCm }) {
  const real = Number(realCm);
  if (!Number.isFinite(real) || real <= 0) {
    return { ok: false, error: "Enter the real distance in centimetres (more than 0)." };
  }
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (px < MIN_POINT_SEPARATION_PX) {
    return { ok: false, error: "The two points are too close together. Place them further apart." };
  }
  return { ok: true, a, b, realCm: real, pxDistance: px, cmPerPx: real / px };
}

const COLORS = { a: "#4da3ff", b: "#ffb24d" };
const LABELS = { a: "A", b: "B" };

// aimer: from marker-pair.js. els: the calibration panel's elements. Returns { getCalibration(), activate(), clear() }.
export function mountCalibration({ aimer, els, onChange = () => {} }) {
  // Calibration keeps its own copy of the points, separate from the aimer's, because the aimer is
  // shared with jump marking: whichever tool is active owns the aimer's current scene, and this one
  // must be able to restore its points when the user switches back to it.
  const points = { a: null, b: null };
  let mode = "a";
  let saved = null;

  function invalidate() {
    saved = null;
    els.result.textContent = "";
    els.result.className = "muted";
    onChange();
  }

  function updateStep() {
    if (saved) {
      els.step.textContent = "Calibration saved";
    } else if (!points.a) {
      els.step.textContent = "Tap point A on the floor";
    } else if (!points.b) {
      els.step.textContent = "Tap point B on the floor";
    } else {
      els.step.textContent = "Enter the real distance, then save";
    }
    els.setA.classList.toggle("selected", mode === "a");
    els.setB.classList.toggle("selected", mode === "b");
    els.save.disabled = !(points.a && points.b);
  }

  // Makes calibration the aimer's active scene, with our own points restored.
  function activate() {
    aimer.setScene({
      keyA: "a",
      keyB: "b",
      colors: COLORS,
      labels: LABELS,
      initialPoints: points,
      onPlace: (key, point, allPoints) => {
        points.a = allPoints.a;
        points.b = allPoints.b;
        if (key === "a") mode = "b"; // mirrors the aimer's own auto-advance from A to B
        invalidate();
        updateStep();
      },
      onRejectOutside: () => { els.step.textContent = "Tap on the picture, not the black border"; },
    });
    aimer.setMode(mode);
    updateStep();
  }

  els.setA.addEventListener("click", () => { mode = "a"; activate(); });
  els.setB.addEventListener("click", () => { mode = "b"; activate(); });

  els.save.addEventListener("click", () => {
    const result = computeCalibration({ a: points.a, b: points.b, realCm: els.cm.value });
    if (!result.ok) {
      els.result.textContent = result.error;
      els.result.className = "warning";
      return;
    }
    saved = result;
    els.result.textContent =
      `${result.realCm} cm = ${result.pxDistance.toFixed(0)} px on screen (${result.cmPerPx.toFixed(3)} cm per px)`;
    els.result.className = "status ok";
    updateStep();
    onChange();
  });

  // Changing the distance after saving needs a new save.
  els.cm.addEventListener("input", () => {
    if (saved) invalidate();
    updateStep();
  });

  activate(); // calibration is the first tool shown once a video loads

  return {
    getCalibration: () => saved,
    activate,
    clear() {
      points.a = null;
      points.b = null;
      mode = "a";
      saved = null;
      els.cm.value = "";
      els.result.textContent = "";
      els.result.className = "muted";
      activate();
      onChange();
    },
  };
}
