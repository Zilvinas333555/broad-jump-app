// Reads the presentation time of every video frame from an MP4/MOV container,
// without decoding anything.
//
// Why not just fps? Phone footage is often variable frame rate, and HEVC/H.264
// B-frames are stored out of display order. A single "fps" number drifts by several
// frames over a 50 s clip, which breaks takeoff/landing precision. So we use the
// real per-frame timestamps:
//   stts = decode time deltas, ctts = offsets from decode time to presentation time.
//
// Returns { frameCount, times, fps, method } or null when the container cannot be read.
//   times:  Float64Array, presentation time in seconds of each frame in display order,
//           starting at 0.
//   fps:    average frame rate (frameCount / duration). Display only; never used for math.
//   method: "constant" when every frame has the same duration, otherwise "variable".

async function readBoxHeader(blob, offset, limit) {
  if (offset + 8 > limit) return null;
  const head = new DataView(await blob.slice(offset, Math.min(offset + 16, limit)).arrayBuffer());
  let size = head.getUint32(0);
  const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
  let headerSize = 8;
  if (size === 1) {
    if (head.byteLength < 16) return null;
    size = Number(head.getBigUint64(8));
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize || offset + size > limit) return null;
  return { type, start: offset, end: offset + size, payloadStart: offset + headerSize };
}

async function listChildren(blob, box) {
  const out = [];
  let offset = box.payloadStart;
  while (offset < box.end) {
    const child = await readBoxHeader(blob, offset, box.end);
    if (!child) break;
    out.push(child);
    offset = child.end;
  }
  return out;
}

async function findChild(blob, box, type) {
  return (await listChildren(blob, box)).find((c) => c.type === type) || null;
}

async function readView(blob, start, length) {
  return new DataView(await blob.slice(start, start + length).arrayBuffer());
}

function fourCC(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

// Returns the sample tables for the first video track, or null.
async function readVideoSampleTables(blob, moov) {
  for (const trak of (await listChildren(blob, moov)).filter((c) => c.type === "trak")) {
    const mdia = await findChild(blob, trak, "mdia");
    const hdlr = mdia && (await findChild(blob, mdia, "hdlr"));
    if (!hdlr) continue;
    if (fourCC(await readView(blob, hdlr.payloadStart + 8, 4), 0) !== "vide") continue;

    const mdhd = await findChild(blob, mdia, "mdhd");
    const minf = await findChild(blob, mdia, "minf");
    const stbl = minf && (await findChild(blob, minf, "stbl"));
    const stts = stbl && (await findChild(blob, stbl, "stts"));
    if (!mdhd || !stts) return null;
    const ctts = await findChild(blob, stbl, "ctts");

    // mdhd version 1 uses 64-bit times, which pushes timescale 8 bytes further on.
    const mdhdVersion = (await readView(blob, mdhd.payloadStart, 1)).getUint8(0);
    const timescale = (await readView(blob, mdhd.payloadStart + (mdhdVersion === 1 ? 20 : 12), 4)).getUint32(0);

    const sttsCount = (await readView(blob, stts.payloadStart + 4, 4)).getUint32(0);
    const sttsView = await readView(blob, stts.payloadStart + 8, sttsCount * 8);
    const sttsEntries = [];
    for (let i = 0; i < sttsCount; i++) {
      sttsEntries.push({ sampleCount: sttsView.getUint32(i * 8), delta: sttsView.getUint32(i * 8 + 4) });
    }

    let cttsEntries = null;
    if (ctts) {
      const cttsCount = (await readView(blob, ctts.payloadStart + 4, 4)).getUint32(0);
      const cttsView = await readView(blob, ctts.payloadStart + 8, cttsCount * 8);
      cttsEntries = [];
      for (let i = 0; i < cttsCount; i++) {
        // Read as signed even for version 0: iPhone files store -1 tick offsets this way,
        // and ffprobe reads them as negative. Reading them unsigned shifts half the frames by ~2^32 ticks.
        cttsEntries.push({ sampleCount: cttsView.getUint32(i * 8), offset: cttsView.getInt32(i * 8 + 4) });
      }
    }
    return { timescale, sttsEntries, cttsEntries };
  }
  return null;
}

export async function readFrameTiming(blob) {
  try {
    let offset = 0;
    let moov = null;
    while (offset < blob.size && !moov) {
      const box = await readBoxHeader(blob, offset, blob.size);
      if (!box) break;
      if (box.type === "moov") moov = box;
      offset = box.end;
    }
    if (!moov) return null;

    const tables = await readVideoSampleTables(blob, moov);
    if (!tables || !tables.timescale) return null;
    const { timescale, sttsEntries, cttsEntries } = tables;

    const frameCount = sttsEntries.reduce((n, e) => n + e.sampleCount, 0);
    if (!frameCount) return null;
    const constant = sttsEntries.every((e) => e.delta === sttsEntries[0].delta);

    // Walk samples in decode order, adding each composition offset to get presentation time.
    const pts = new Float64Array(frameCount);
    let dts = 0;
    let sample = 0;
    let sttsIdx = 0;
    let sttsLeft = sttsEntries[0] ? sttsEntries[0].sampleCount : 0;
    let cttsIdx = 0;
    let cttsLeft = cttsEntries && cttsEntries[0] ? cttsEntries[0].sampleCount : 0;
    while (sample < frameCount) {
      while (sttsLeft === 0 && sttsIdx < sttsEntries.length - 1) { sttsIdx++; sttsLeft = sttsEntries[sttsIdx].sampleCount; }
      let compOffset = 0;
      if (cttsEntries) {
        while (cttsLeft === 0 && cttsIdx < cttsEntries.length - 1) { cttsIdx++; cttsLeft = cttsEntries[cttsIdx].sampleCount; }
        if (cttsLeft > 0) compOffset = cttsEntries[cttsIdx].offset;
        cttsLeft--;
      }
      pts[sample] = dts + compOffset;
      dts += sttsEntries[sttsIdx].delta;
      sttsLeft--;
      sample++;
    }

    pts.sort(); // display order; Float64Array.sort is numeric
    const origin = pts[0];
    const times = new Float64Array(frameCount);
    for (let i = 0; i < frameCount; i++) times[i] = (pts[i] - origin) / timescale;

    const duration = frameCount > 1
      ? times[frameCount - 1] - times[0] + (times[frameCount - 1] - times[frameCount - 2])
      : 0;
    const fps = duration > 0 ? frameCount / duration : null;

    return { frameCount, times, fps, method: constant ? "constant" : "variable" };
  } catch (err) {
    console.warn("Frame timing could not be read:", err);
    return null;
  }
}
