// Stage 2: read a picked video file and decide whether it can be used at all.
// Only BLOCK conditions are checked here (undecodable, no video track, under 1 s).
// Quality warnings and FPS detection come in Stages 4–5.

export const MIN_DURATION_S = 1;

// Pure function: takes the numbers read from a <video> element and returns
// { ok, blockers[], info }. Kept free of DOM so it can be unit-tested with node.
export function classifyIntake({ readyState, errorCode, duration, videoWidth, videoHeight }) {
  const blockers = [];

  if (errorCode) {
    blockers.push("This video could not be decoded. Try another file or re-export it as MP4/MOV (H.264).");
  } else if (!Number.isFinite(duration) || duration <= 0 || readyState < 1) {
    blockers.push("The browser could not read this video's length.");
  }

  // Only report a missing track when decoding itself succeeded; otherwise the decode error already explains it.
  if (!errorCode && (!videoWidth || !videoHeight)) {
    blockers.push("No usable video track was found in this file.");
  }

  if (!blockers.length && duration < MIN_DURATION_S) {
    blockers.push(`Video is ${duration.toFixed(2)} s long. At least ${MIN_DURATION_S} s is needed.`);
  }

  const orientation = !videoWidth || !videoHeight
    ? "unknown"
    : videoHeight > videoWidth ? "portrait" : videoWidth > videoHeight ? "landscape" : "square";

  return {
    ok: blockers.length === 0,
    blockers,
    info: {
      durationS: Number.isFinite(duration) ? duration : null,
      width: videoWidth || null,
      height: videoHeight || null,
      orientation,
    },
  };
}

// Loads a File into a hidden <video> and resolves with the classification.
// Returns { objectUrl, result }. The caller owns objectUrl and must revoke it.
export function inspectVideoFile(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;

    const finish = (result) => {
      probe.removeAttribute("src");
      probe.load();
      resolve({ objectUrl, result });
    };

    probe.addEventListener("loadedmetadata", () => {
      finish(classifyIntake({
        readyState: probe.readyState,
        errorCode: null,
        duration: probe.duration,
        videoWidth: probe.videoWidth,
        videoHeight: probe.videoHeight,
      }));
    });

    probe.addEventListener("error", () => {
      finish(classifyIntake({
        readyState: 0,
        errorCode: probe.error ? probe.error.code : 4,
        duration: NaN,
        videoWidth: 0,
        videoHeight: 0,
      }));
    });

    probe.src = objectUrl;
  });
}
