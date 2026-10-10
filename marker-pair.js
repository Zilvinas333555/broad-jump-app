// A two-point marker aimer shared by calibration (A/B) and jump marking (takeoff/landing).
// Press and hold on the video picture to aim with a magnifier; release to place the point.
//
// Only one "scene" is active at a time: a pair of point keys, their colors/labels, and callbacks.
// Calibration and jump marking each own their points externally and hand a scene to this aimer
// when they become the active tool, so only one set of pointer listeners ever exists on the canvas.
import { contentRect, boxToVideo, videoToBox, insideContent, loupeSource, loupePlacement, LOUPE_SIZE_PX } from "./overlay-geometry.js";

export function mountAimer({ video, canvas, loupe, currentFrame }) {
  const ctx = canvas.getContext("2d");
  let scene = null;
  let aim = null; // box-pixel point currently held down, or null

  function draw() {
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(boxW * dpr);
    canvas.height = Math.round(boxH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boxW, boxH);
    if (!scene || !video.videoWidth || !video.videoHeight) return;

    const rect = contentRect(boxW, boxH, video.videoWidth, video.videoHeight);
    const { keyA, keyB, colors, labels, points } = scene;
    const pa = points[keyA] && videoToBox(rect, points[keyA].x, points[keyA].y);
    const pb = points[keyB] && videoToBox(rect, points[keyB].x, points[keyB].y);
    if (pa && pb) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    for (const [key, p] of [[keyA, pa], [keyB, pb]]) {
      if (!p) continue;
      ctx.fillStyle = colors[key];
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
      ctx.fillText(labels[key], p.x, p.y);
    }
  }

  function drawLoupe() {
    const boxW = canvas.clientWidth;
    const boxH = canvas.clientHeight;
    const pos = loupePlacement(aim.x, aim.y, boxW, boxH);
    loupe.style.left = pos.left + "px";
    loupe.style.top = pos.top + "px";
    loupe.hidden = false;

    const dpr = window.devicePixelRatio || 1;
    const size = LOUPE_SIZE_PX;
    if (loupe.width !== Math.round(size * dpr)) {
      loupe.width = Math.round(size * dpr);
      loupe.height = Math.round(size * dpr);
    }
    const lctx = loupe.getContext("2d");
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.fillStyle = "#000";
    lctx.fillRect(0, 0, size, size);

    const rect = video.videoWidth ? contentRect(boxW, boxH, video.videoWidth, video.videoHeight) : null;
    if (rect && insideContent(rect, aim.x, aim.y)) {
      const src = loupeSource(rect, aim.x, aim.y);
      lctx.drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, size, size);
    }
    // Crosshair at the centre: this is exactly where the point will be placed.
    lctx.strokeStyle = "#ffffff";
    lctx.lineWidth = 1;
    lctx.beginPath();
    lctx.moveTo(size / 2, 8); lctx.lineTo(size / 2, size - 8);
    lctx.moveTo(8, size / 2); lctx.lineTo(size - 8, size / 2);
    lctx.stroke();
    lctx.fillStyle = scene ? scene.colors[scene.mode] : "#ffffff";
    lctx.beginPath();
    lctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
    lctx.fill();
  }

  function hideLoupe() {
    loupe.hidden = true;
  }

  function place(bx, by) {
    if (!scene || !video.videoWidth) return;
    const rect = contentRect(canvas.clientWidth, canvas.clientHeight, video.videoWidth, video.videoHeight);
    if (!insideContent(rect, bx, by)) {
      scene.onRejectOutside && scene.onRejectOutside();
      return;
    }
    const v = boxToVideo(rect, bx, by);
    const key = scene.mode;
    const point = { x: v.x, y: v.y, frame: currentFrame() };
    scene.points[key] = point;
    // After placing the first point, move on to the second; after the second, stay there so it can be adjusted.
    if (key === scene.keyA) scene.mode = scene.keyB;
    draw();
    scene.onPlace && scene.onPlace(key, point, { ...scene.points });
  }

  const pointInBox = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (!scene) return;
    e.preventDefault();
    // Keeps move/up events on the canvas even if the finger slides off it. Failure must not stop aiming.
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer not active */ }
    aim = pointInBox(e);
    drawLoupe();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!aim) return;
    aim = pointInBox(e);
    drawLoupe();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!aim) return;
    const p = pointInBox(e);
    aim = null;
    hideLoupe();
    place(p.x, p.y);
  });
  canvas.addEventListener("pointercancel", () => {
    aim = null;
    hideLoupe();
  });

  new ResizeObserver(draw).observe(canvas);
  video.addEventListener("loadedmetadata", draw);

  return {
    // Replaces the active scene. initialPoints restores points when re-opening something already marked.
    setScene({ keyA, keyB, colors, labels, initialPoints, onPlace, onRejectOutside }) {
      scene = {
        keyA,
        keyB,
        colors,
        labels,
        points: { [keyA]: initialPoints?.[keyA] || null, [keyB]: initialPoints?.[keyB] || null },
        mode: keyA,
        onPlace,
        onRejectOutside,
      };
      draw();
    },
    clearScene() {
      if (!scene) return;
      scene = null;
      draw();
    },
    setMode(key) {
      if (scene) scene.mode = key;
    },
    getMode: () => (scene ? scene.mode : null),
    getPoints: () => (scene ? { ...scene.points } : {}),
    redraw: draw,
  };
}
