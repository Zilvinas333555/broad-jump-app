// Stage 2: intake. Stage 3: player. Stage 5: footage checks (notes only, never a gate). Stage 6: calibration.
import { inspectVideoFile } from "./video-intake.js";
import { readFrameTiming } from "./mp4-timing.js";
import { loadPlayer, playerVideo, currentFrameIndex } from "./player.js";
import { sampleFootage, buildMetadataChecks, buildFrameChecks } from "./footage-checks.js";
import { mountCalibration } from "./calibration.js";

const screens = {
  start: document.getElementById("screen-start"),
  check: document.getElementById("screen-check"),
  player: document.getElementById("screen-player"),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  window.scrollTo(0, 0);
}

const fileInput = document.getElementById("file-input");
const fileCapture = document.getElementById("file-capture");
const intakeBox = document.getElementById("intake");
const intakeStatus = document.getElementById("intake-status");
const intakeDetails = document.getElementById("intake-details");
const intakeBlockers = document.getElementById("intake-blockers");
const notesBox = document.getElementById("footage-notes");
const notesTitle = notesBox.querySelector(".notes-title");
const notesList = document.getElementById("footage-notes-list");

const calibration = mountCalibration({
  video: playerVideo,
  canvas: document.getElementById("calib-overlay"),
  els: {
    step: document.getElementById("calib-step"),
    setA: document.getElementById("btn-set-a"),
    setB: document.getElementById("btn-set-b"),
    cm: document.getElementById("calib-cm"),
    save: document.getElementById("btn-calib-save"),
    result: document.getElementById("calib-result"),
  },
  currentFrame: currentFrameIndex,
});

let currentObjectUrl = null;
// Each pick gets a run id, so a slow check for an old file cannot overwrite the new one.
let runId = 0;

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDuration(s) {
  return s == null ? "unknown" : s.toFixed(2) + " s";
}

function renderIntake(file, info, ok, blockers) {
  intakeDetails.innerHTML = "";
  const rows = [
    ["File", file.name],
    ["Size", formatMB(file.size)],
    ["Duration", formatDuration(info.durationS)],
    ["Resolution", info.width && info.height ? `${info.width} × ${info.height}` : "unknown"],
    ["Orientation", info.orientation],
  ];
  for (const [label, value] of rows) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><strong></strong>`;
    li.children[0].textContent = label;
    li.children[1].textContent = value;
    intakeDetails.appendChild(li);
  }

  intakeBlockers.innerHTML = "";
  for (const msg of blockers) {
    const p = document.createElement("p");
    p.className = "block-msg";
    p.textContent = msg;
    intakeBlockers.appendChild(p);
  }

  intakeStatus.textContent = ok ? "Video readable" : "Cannot analyze this video";
  intakeStatus.className = ok ? "status ok" : "status error";
  intakeBox.hidden = false;
}

// Notes appear only when something needs attention. A clean file shows nothing.
function renderNotes(checks, { pending = false } = {}) {
  const issues = checks.filter((c) => c.status === "warn" || c.status === "block");
  notesTitle.textContent = pending ? "Checking footage…" : "Footage notes";
  notesList.innerHTML = "";
  for (const c of issues) {
    const li = document.createElement("li");
    const label = document.createElement("strong");
    label.textContent = c.label + ": ";
    li.append(label, document.createTextNode(c.detail));
    notesList.appendChild(li);
  }
  notesBox.hidden = !pending && issues.length === 0;
}

async function runFrameChecks(id, info, timing) {
  try {
    const samples = await sampleFootage(playerVideo, timing, () => {}, () => id !== runId);
    if (id !== runId) return;
    const all = [...buildMetadataChecks({ info, timing }), ...buildFrameChecks({ samples })];
    renderNotes(all);
  } catch (err) {
    if (id !== runId) return;
    // A failed background check is a note, not a block: the user can still measure.
    renderNotes([
      ...buildMetadataChecks({ info, timing }),
      { id: "frames", label: "Frame checks", status: "warn", detail: `Could not run: ${err.message}` },
    ]);
  }
}

async function onVideoPicked(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const id = ++runId;
  calibration.clear();
  document.getElementById("video-name").textContent = file.name;
  intakeBox.hidden = true;
  showScreen("check");

  const inspected = await inspectVideoFile(file);
  if (id !== runId) return;
  const info = inspected.result.info;
  renderIntake(file, info, inspected.result.ok, inspected.result.blockers);

  if (currentObjectUrl && currentObjectUrl !== inspected.objectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = inspected.objectUrl;

  // Only a file that cannot be read stops here.
  if (!inspected.result.ok) return;

  const timing = await readFrameTiming(file);
  if (id !== runId) return;
  loadPlayer(currentObjectUrl, timing);
  showScreen("player");
  renderNotes(buildMetadataChecks({ info, timing }), { pending: true });

  // Not awaited: the player works while frames are checked in the background.
  runFrameChecks(id, info, timing);
}

fileInput.addEventListener("change", onVideoPicked);
fileCapture.addEventListener("change", onVideoPicked);

document.getElementById("btn-check-back").addEventListener("click", () => {
  runId++;
  showScreen("start");
});
document.getElementById("btn-player-new").addEventListener("click", () => {
  runId++;
  calibration.clear();
  showScreen("start");
});
