// Stage 2: video intake. Stage 3: player. Stage 5: footage checks gate the flow.
import { inspectVideoFile } from "./video-intake.js";
import { readFrameTiming } from "./mp4-timing.js";
import { loadPlayer, playerVideo } from "./player.js";
import { sampleFootage, buildChecks } from "./footage-checks.js";

const screens = {
  start: document.getElementById("screen-start"),
  check: document.getElementById("screen-check"),
  player: document.getElementById("screen-player"),
};

// The video element moves between the check preview and the player. It must stay visible
// (not display:none) while frames are being checked, or iPhone Safari stops seeking.
const previewSlot = document.getElementById("preview-slot");
const playerSlot = document.getElementById("player-slot");

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  if (name === "check") previewSlot.appendChild(playerVideo);
  if (name === "player") playerSlot.appendChild(playerVideo);
  window.scrollTo(0, 0);
}

const fileInput = document.getElementById("file-input");
const fileCapture = document.getElementById("file-capture");
const intakeBox = document.getElementById("intake");
const intakeStatus = document.getElementById("intake-status");
const intakeDetails = document.getElementById("intake-details");
const intakeBlockers = document.getElementById("intake-blockers");
const checkStatus = document.getElementById("check-status");
const checkProgress = document.getElementById("check-progress");
const checkList = document.getElementById("check-list");
const checkNote = document.getElementById("check-note");
const checkBlockers = document.getElementById("check-blockers");
const btnContinue = document.getElementById("btn-continue");

const STATUS_ICON = { ok: "✓", warn: "⚠", block: "✖", unknown: "–" };

let currentObjectUrl = null;
let currentTiming = null;
let currentInfo = null;
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

function renderChecks(result) {
  checkList.innerHTML = "";
  for (const c of result.checks) {
    const li = document.createElement("li");
    li.className = `check ${c.status}`;
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = STATUS_ICON[c.status] || "–";
    const body = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = c.label;
    const detail = document.createElement("div");
    detail.className = "check-detail";
    detail.textContent = c.detail;
    body.append(label, detail);
    li.append(icon, body);
    checkList.appendChild(li);
  }

  checkBlockers.innerHTML = "";
  if (result.blocked) {
    checkStatus.textContent = "Cannot analyze this video";
    checkStatus.className = "status error";
  } else if (result.warnings > 0) {
    checkStatus.textContent = `${result.warnings} warning${result.warnings === 1 ? "" : "s"}`;
    checkStatus.className = "status warn";
  } else {
    checkStatus.textContent = "Footage looks good";
    checkStatus.className = "status ok";
  }
  checkNote.hidden = !(result.warnings > 0 && !result.blocked);
  btnContinue.disabled = result.blocked;
}

async function runChecks(id, timing) {
  checkStatus.textContent = "Checking footage…";
  checkStatus.className = "status";
  checkList.innerHTML = "";
  checkNote.hidden = true;
  checkProgress.hidden = false;
  checkProgress.textContent = "Checking frames…";
  btnContinue.disabled = true;

  try {
    const samples = await sampleFootage(playerVideo, timing, (k, n) => {
      if (id === runId) checkProgress.textContent = `Checking frame ${Math.min(k + 1, n)} of ${n}…`;
    });
    if (id !== runId) return;
    const info = currentInfo;
    renderChecks(buildChecks({ info, timing, samples }));
  } catch (err) {
    if (id !== runId) return;
    checkStatus.textContent = "Checks could not run on this video";
    checkStatus.className = "status error";
    checkBlockers.innerHTML = "";
    const p = document.createElement("p");
    p.className = "block-msg";
    p.textContent = err.message;
    checkBlockers.appendChild(p);
    btnContinue.disabled = true;
  } finally {
    if (id === runId) checkProgress.hidden = true;
  }
}

async function onVideoPicked(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const id = ++runId;
  document.getElementById("video-name").textContent = file.name;
  intakeBox.hidden = true;
  checkStatus.textContent = "Checking video…";
  checkList.innerHTML = "";
  btnContinue.disabled = true;
  showScreen("check");

  const inspected = await inspectVideoFile(file);
  if (id !== runId) return;
  currentInfo = inspected.result.info;
  renderIntake(file, inspected.result.info, inspected.result.ok, inspected.result.blockers);

  if (currentObjectUrl && currentObjectUrl !== inspected.objectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = inspected.objectUrl;

  if (!inspected.result.ok) {
    checkStatus.textContent = "Cannot analyze this video";
    checkStatus.className = "status error";
    return;
  }

  currentTiming = await readFrameTiming(file);
  if (id !== runId) return;
  loadPlayer(currentObjectUrl, currentTiming);
  await runChecks(id, currentTiming);
}

fileInput.addEventListener("change", onVideoPicked);
fileCapture.addEventListener("change", onVideoPicked);

document.getElementById("btn-record").addEventListener("click", () => fileCapture.click());
document.getElementById("btn-check-back").addEventListener("click", () => {
  runId++;
  showScreen("start");
});
btnContinue.addEventListener("click", () => showScreen("player"));
document.getElementById("btn-player-back").addEventListener("click", () => showScreen("check"));
document.getElementById("btn-player-new").addEventListener("click", () => {
  runId++;
  showScreen("start");
});
