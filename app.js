// Stage 2: video intake. Stage 3: player and frame controls.
import { inspectVideoFile } from "./video-intake.js";
import { readFrameTiming } from "./mp4-timing.js";
import { loadPlayer } from "./player.js";

const screens = {
  start: document.getElementById("screen-start"),
  video: document.getElementById("screen-video"),
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
const btnContinue = document.getElementById("btn-continue");

let currentObjectUrl = null;

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDuration(s) {
  return s == null ? "unknown" : s.toFixed(2) + " s";
}

function renderIntake(file, { objectUrl, result }) {
  // Only the most recent file is kept; release the previous one.
  if (currentObjectUrl && currentObjectUrl !== objectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = objectUrl;

  const { info, ok, blockers } = result;
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
    p.textContent = msg;
    intakeBlockers.appendChild(p);
  }

  intakeStatus.textContent = ok ? "Video readable" : "Cannot analyze this video";
  intakeStatus.className = ok ? "status ok" : "status error";
  btnContinue.disabled = !ok;
  intakeBox.hidden = false;
}

async function onVideoPicked(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  intakeBox.hidden = false;
  intakeStatus.textContent = "Checking video…";
  intakeStatus.className = "status";
  intakeDetails.innerHTML = "";
  intakeBlockers.innerHTML = "";
  btnContinue.disabled = true;
  showScreen("video");
  document.getElementById("video-name").textContent = file.name;

  const inspected = await inspectVideoFile(file);
  renderIntake(file, inspected);

  if (inspected.result.ok) {
    const timing = await readFrameTiming(file);
    loadPlayer(inspected.objectUrl, timing);
  }
}

fileInput.addEventListener("change", onVideoPicked);
fileCapture.addEventListener("change", onVideoPicked);

document.getElementById("btn-record").addEventListener("click", () => fileCapture.click());
document.getElementById("btn-back").addEventListener("click", () => showScreen("start"));
