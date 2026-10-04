// Stage 6: two-point floor calibration.
// The user taps two points on the same floor plane whose real distance is known, then enters that distance.
//   scale = real cm / pixel distance between the two points
// V1 limitation: simple scaling only. No perspective correction, so the result is less accurate when the
// camera is angled or the calibration points are at a different depth from the jump.
//
// The pure functions at the top are unit-tested. mountCalibration() at the bottom is the DOM part.

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

// ---------------------------------------------------------------------------
// DOM part

const COLORS = { a: "#4da3ff", b: "#ffb24d" };

// Wires the calibration panel and the tap-to-place overlay.
// video: the player's <video>; canvas: overlay on top of it; els: panel elements; currentFrame(): frame index.
// Returns { getCalibration(), clear() }.
export function mountCalibration({ video, canvas, els, currentFrame }) {
  const ctx = canvas.getContext("2d");
  const points = { a: null, b: null };
  let mode = "a";
  let saved = null;

  function invalidate() {
    saved = null;
    els.result.textContent = "";
    els.result.className = "muted";
  }

  function draw() {
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(boxH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = contentRect(boxW, boxH, video.videoWidth, video.videoHeight);
    const pa = points.a && videoToBox(rect, points.a.x, points.a.y);
    const pb = points.b && videoToBox(rect, points.b.x, points.b.y);
    if (pa && pb) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    for (const [key, p] of [["a", pa], ["b", pb]]) {
      if (!p) continue;
      ctx.fillStyle = COLORS[key];
      ctx.strokeStyle = "#05111f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#05111f";
      ctx.font = "bold 13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(key.toUpperCase(), p.x, p.y);
    }
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

  function place(bx, by) {
    if (!video.videoWidth) return;
    const rect = contentRect(canvas.clientWidth, canvas.clientHeight, video.videoWidth, video.videoHeight);
    if (!insideContent(rect, bx, by)) {
      els.step.textContent = "Tap on the picture, not the black border";
      return;
    }
    const v = boxToVideo(rect, bx, by);
    const frame = currentFrame();
    points[mode] = { x: v.x, y: v.y, frame };
    invalidate();
    // After placing A, move on to B; after placing B, stay on B so it can be adjusted.
    if (mode === "a") mode = "b";
    draw();
    updateStep();
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    place(e.clientX - r.left, e.clientY - r.top);
  });

  els.setA.addEventListener("click", () => { mode = "a"; updateStep(); });
  els.setB.addEventListener("click", () => { mode = "b"; updateStep(); });

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
  });

  // Changing the distance after saving needs a new save.
  els.cm.addEventListener("input", () => {
    if (saved) invalidate();
    updateStep();
  });

  // The overlay must follow the picture when the layout or window size changes.
  new ResizeObserver(draw).observe(canvas);
  video.addEventListener("loadedmetadata", draw);

  updateStep();
  return {
    getCalibration: () => saved,
    clear() {
      points.a = null;
      points.b = null;
      mode = "a";
      invalidate();
      els.cm.value = "";
      draw();
      updateStep();
    },
  };
}
