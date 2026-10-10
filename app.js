// Stage 2: intake. Stage 3: player. Stage 5: footage checks (notes only, never a gate).
// Stage 6: calibration. Stage 7-8: jump markers and distance. Stage 9: the jump list.
import { inspectVideoFile } from "./video-intake.js";
import { readFrameTiming } from "./mp4-timing.js";
import { loadPlayer, playerVideo, currentFrameIndex, goToFrame } from "./player.js";
import { sampleFootage, buildMetadataChecks, buildFrameChecks } from "./footage-checks.js";
import { mountAimer } from "./marker-pair.js";
import { mountCalibration } from "./calibration.js";
import { mountJumpMarking } from "./jump-marking.js";
import { summarizeJumps } from "./jumps.js";

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

// One shared aimer: calibration and jump marking each hand it a "scene" when they become active,
// so there is only ever one set of pointer listeners on the video overlay.
const aimer = mountAimer({
  video: playerVideo,
  canvas: document.getElementById("marker-overlay"),
  loupe: document.getElementById("marker-loupe"),
  currentFrame: currentFrameIndex,
});

const btnAddJump = document.getElementById("btn-add-jump");
const jumpsHint = document.getElementById("jumps-hint");

const calibration = mountCalibration({
  aimer,
  els: {
    step: document.getElementById("calib-step"),
    setA: document.getElementById("btn-set-a"),
    setB: document.getElementById("btn-set-b"),
    cm: document.getElementById("calib-cm"),
    save: document.getElementById("btn-calib-save"),
    result: document.getElementById("calib-result"),
  },
  onChange: updateAddJumpAvailability,
});

function updateAddJumpAvailability() {
  const calibrated = Boolean(calibration.getCalibration());
  btnAddJump.disabled = !calibrated || jumpMarking.isOpen();
  jumpsHint.hidden = calibrated;
}

const jumpMarking = mountJumpMarking({
  aimer,
  els: {
    card: document.getElementById("jump-card"),
    title: document.getElementById("jump-card-title"),
    step: document.getElementById("jump-step"),
    setTakeoff: document.getElementById("btn-set-takeoff"),
    setLanding: document.getElementById("btn-set-landing"),
    result: document.getElementById("jump-result"),
    cancel: document.getElementById("btn-jump-cancel"),
    save: document.getElementById("btn-jump-save"),
  },
  getCalibration: calibration.getCalibration,
  goToFrame,
});

// Jumps for the video currently loaded. Not persisted yet (Stage 10).
let jumps = [];
let nextJumpId = 1;

const jumpsTable = document.getElementById("jumps-table");
const jumpsRows = document.getElementById("jumps-rows");
const jumpsEmpty = document.getElementById("jumps-empty");
const jumpsSummary = document.getElementById("jumps-summary");

function renderJumps() {
  jumpsEmpty.hidden = jumps.length > 0;
  jumpsTable.hidden = jumps.length === 0;
  jumpsSummary.hidden = jumps.length === 0;
  jumpsRows.innerHTML = "";

  jumps.forEach((jump, i) => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.className = "jump-row";
    const num = document.createElement("td");
    num.textContent = String(i + 1);
    const dist = document.createElement("td");
    dist.textContent = jump.distanceM == null ? "—" : `${jump.distanceM.toFixed(2)} m`;
    const edit = document.createElement("td");
    edit.textContent = "Edit";
    edit.className = "edit-link";
    tr.append(num, dist, edit);
    const openThis = () => openJumpEditor(jump, i);
    tr.addEventListener("click", openThis);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openThis(); });
    jumpsRows.appendChild(tr);
  });

  const { best, average } = summarizeJumps(jumps);
  jumpsSummary.textContent = jumps.length
    ? `Best: ${best.toFixed(2)} m · Average: ${average.toFixed(2)} m · ${jumps.length} attempt${jumps.length === 1 ? "" : "s"}`
    : "";
}

function openJumpEditor(jump, index) {
  document.getElementById("jump-card-title").textContent = jump ? `Edit jump ${index + 1}` : "New jump";
  jumpMarking.open(jump || null);
  updateAddJumpAvailability();
}

btnAddJump.addEventListener("click", () => openJumpEditor(null, -1));

jumpMarking.onSave((result) => {
  if (result.id != null) {
    const i = jumps.findIndex((j) => j.id === result.id);
    if (i !== -1) jumps[i] = result;
  } else {
    jumps.push({ ...result, id: nextJumpId++ });
  }
  renderJumps();
  updateAddJumpAvailability();
});

document.getElementById("btn-jump-cancel").addEventListener("click", updateAddJumpAvailability);

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

function resetForNewVideo() {
  // Order matters: whichever of these runs last owns the shared aimer's active scene.
  // Calibration must be the one left active, so it goes last.
  jumpMarking.close();
  calibration.clear();
  jumps = [];
  nextJumpId = 1;
  renderJumps();
  updateAddJumpAvailability();
}

async function handlePick(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const id = ++runId;
  resetForNewVideo();
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

// Any failure while handling a file is shown on screen, so it can be reported without a debugger.
async function onVideoPicked(event) {
  try {
    await handlePick(event);
  } catch (err) {
    showFatal(`Could not open this video: ${err && err.message ? err.message : err}`);
  }
}

function showFatal(message) {
  intakeStatus.textContent = message;
  intakeStatus.className = "status error";
  intakeBox.hidden = false;
  showScreen("check");
}

fileInput.addEventListener("change", onVideoPicked);
fileCapture.addEventListener("change", onVideoPicked);

document.getElementById("btn-check-back").addEventListener("click", () => {
  runId++;
  showScreen("start");
});
document.getElementById("btn-player-new").addEventListener("click", () => {
  runId++;
  resetForNewVideo();
  showScreen("start");
});

renderJumps();
updateAddJumpAvailability();
