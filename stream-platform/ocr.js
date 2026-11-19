// Handwriting OCR for proof photos (Poetry check-ins), run entirely in the browser.
//
// 1. findTextLines() splits the photo into lines of writing using an ink mask and a
//    horizontal projection profile. If the writing doesn't sit in clearly separated,
//    roughly straight lines (no paper lines, written across them, slanted, overlapping),
//    we stop and report NO_STRONG_OCR without transcribing anything.
// 2. Each line goes through TrOCR (Xenova/trocr-small-handwritten, MIT) via Transformers.js.
//    TrOCR reads one line at a time, which is why step 1 exists. The model (~60 MB) is
//    fetched from the Hugging Face CDN on first use and cached by the browser; nothing is
//    sent to our server, which stays within Vercel's free plan.
//
// Declares transcribeHandwriting / findTextLines / NO_STRONG_OCR. Must not declare `$` or `esc`.

const NO_STRONG_OCR = "No strong OCR";
const TRANSFORMERS_SRC = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const OCR_MODEL = "Xenova/trocr-small-handwritten";
const OCR_MAX_LINES = 40;

/* ---------- Line finding (pure; works on a grayscale buffer) ---------- */

// gray: Uint8Array of W*H luminance values. Returns { ok: true, lines: [{ x0, x1, y0, y1 }] }
// in pixel coordinates, or { ok: false, reason } when there are no clearly defined lines.
function findTextLines(gray, W, H) {
  const fail = (reason) => ({ ok: false, reason });

  // Ink = noticeably darker than its neighborhood (handles shadows and uneven phone lighting).
  const r = Math.max(8, Math.round(Math.min(W, H) / 40));
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1);
      const sum = integ[yb * (W + 1) + xb] - integ[ya * (W + 1) + xb] - integ[yb * (W + 1) + xa] + integ[ya * (W + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      const g = gray[y * W + x];
      if (g < mean - Math.max(14, 0.14 * mean)) ink[y * W + x] = 1;
    }
  }

  // Erase printed ruling: horizontal runs longer than a fifth of the width (paper lines,
  // page edges) and vertical runs taller than 60% of the height (margin lines).
  const longX = Math.max(40, W * 0.2), longY = Math.max(40, H * 0.6);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W;) {
      if (!ink[y * W + x]) { x++; continue; }
      let e = x;
      while (e < W && ink[y * W + e]) e++;
      if (e - x > longX) ink.fill(0, y * W + x, y * W + e);
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H;) {
      if (!ink[y * W + x]) { y++; continue; }
      let e = y;
      while (e < H && ink[e * W + x]) e++;
      if (e - y > longY) for (let k = y; k < e; k++) ink[k * W + x] = 0;
      y = e;
    }
  }
  // Ignore a thin border, where paper edges and shadows live.
  const bx = Math.round(W * 0.015), by = Math.round(H * 0.015);

  const prof = new Float64Array(H);
  let total = 0;
  for (let y = by; y < H - by; y++) {
    let n = 0;
    for (let x = bx; x < W - bx; x++) n += ink[y * W + x];
    prof[y] = n;
    total += n;
  }
  const frac = total / (W * H);
  if (frac < 0.0015) return fail("no writing found");
  if (frac > 0.2) return fail("too busy to be lines of writing");

  const smooth = prof.map((_, y) => (prof[y - 1] ?? prof[y]) / 4 + prof[y] / 2 + (prof[y + 1] ?? prof[y]) / 4);
  const sorted = [...smooth].filter((v) => v > 0).sort((a, b) => a - b);
  const peak = sorted[Math.floor(sorted.length * 0.95)] || 0;
  if (!peak) return fail("no writing found");
  const on = (y) => smooth[y] > peak * 0.12;

  // Bands = runs of rows with ink. Clean gaps between them are what "clearly defined" means.
  let bands = [];
  for (let y = 0; y < H;) {
    if (!on(y)) { y++; continue; }
    let e = y, mass = 0;
    while (e < H && on(e)) mass += prof[e++];
    bands.push({ y0: y, y1: e, mass });
    y = e;
  }
  const maxMass = Math.max(0, ...bands.map((b) => b.mass));
  bands = bands.filter((b) => b.y1 - b.y0 >= 3 && b.mass >= maxMass * 0.04); // drop specks and dots
  if (!bands.length) return fail("no writing found");
  if (bands.length > OCR_MAX_LINES) return fail("too many lines");

  const heights = bands.map((b) => b.y1 - b.y0).sort((a, b) => a - b);
  const med = heights[Math.floor(heights.length / 2)];
  if (bands.length > 1 && bands.some((b) => b.y1 - b.y0 > med * 1.8)) return fail("lines run into each other");

  const lines = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const h = b.y1 - b.y0;
    // Horizontal extent: trim the outer 1% of ink on each side.
    const cols = new Float64Array(W);
    let mass = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = bx; x < W - bx; x++) if (ink[y * W + x]) { cols[x]++; mass++; }
    let acc = 0, x0 = 0, x1 = W - 1;
    for (let x = 0; x < W; x++) { acc += cols[x]; if (acc > mass * 0.01) { x0 = x; break; } }
    acc = 0;
    for (let x = W - 1; x >= 0; x--) { acc += cols[x]; if (acc > mass * 0.01) { x1 = x; break; } }
    if ((x1 - x0) / h < 1.5) return fail("writing isn't laid out in lines");

    // Straightness: the ink's vertical center at the left and right thirds should agree.
    const third = (x1 - x0) / 3;
    const center = (xa, xb) => {
      let s = 0, n = 0;
      for (let y = b.y0; y < b.y1; y++) for (let x = Math.round(xa); x < xb; x++) if (ink[y * W + x]) { s += y; n++; }
      return n ? s / n : null;
    };
    const cl = center(x0, x0 + third), cr = center(x1 - third, x1 + 1);
    if (cl != null && cr != null && Math.abs(cl - cr) > h * 0.45) return fail("writing is slanted across the lines");

    // Pad into the gaps for ascenders/descenders, without reaching the neighboring lines.
    const above = i ? (b.y0 - bands[i - 1].y1) / 2 : med;
    const below = i < bands.length - 1 ? (bands[i + 1].y0 - b.y1) / 2 : med;
    const pad = Math.round(med * 0.3);
    lines.push({
      x0: Math.max(0, x0 - pad), x1: Math.min(W, x1 + pad + 1),
      y0: Math.max(0, Math.round(b.y0 - Math.min(above, med * 0.5))),
      y1: Math.min(H, Math.round(b.y1 + Math.min(below, med * 0.5))),
    });
  }
  return { ok: true, lines };
}

/* ---------- Model ---------- */

let ocrPipeline = null;
function loadOcrModel(onProgress) {
  ocrPipeline ||= (async () => {
    const { pipeline } = await import(TRANSFORMERS_SRC);
    const seen = {};
    return pipeline("image-to-text", OCR_MODEL, {
      dtype: "q8",
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        seen[p.file] = [p.loaded, p.total];
        const [l, t] = Object.values(seen).reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
        onProgress?.(`Downloading the handwriting model (first time only)… ${Math.round((l / t) * 100)}%`);
      },
    });
  })().catch((e) => {
    ocrPipeline = null;
    throw new Error(`Couldn't load the handwriting model. ${e.message || ""}`.trim());
  });
  return ocrPipeline;
}

// A line the model clearly couldn't read: empty, no letters, or stuck repeating itself.
const weakLine = (t) => !/\p{L}/u.test(t) || /(\b\S+\b)(\s+\1\b){3,}/i.test(t);

/* ---------- Entry point ---------- */

// src: an image URL or data URL. Resolves { ok: true, text } or { ok: false, reason }.
// Throws only if the model can't be loaded.
async function transcribeHandwriting(src, onProgress) {
  const im = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't read that photo."));
    i.src = src;
  });
  const k = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.round(im.naturalWidth * k), H = Math.round(im.naturalHeight * k);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;

  const found = findTextLines(gray, W, H);
  if (!found.ok) return found;

  const ocr = await loadOcrModel(onProgress);
  const out = [];
  let weak = 0;
  for (const [i, l] of found.lines.entries()) {
    onProgress?.(`Reading line ${i + 1} of ${found.lines.length}…`);
    const c = document.createElement("canvas");
    c.width = l.x1 - l.x0; c.height = l.y1 - l.y0;
    c.getContext("2d").drawImage(cv, l.x0, l.y0, c.width, c.height, 0, 0, c.width, c.height);
    const [res] = await ocr(c.toDataURL("image/png"), { max_new_tokens: 64 });
    const text = (res?.generated_text || "").trim();
    if (weakLine(text)) weak++;
    else out.push(text);
  }
  // Too many unreadable lines means the transcription can't be trusted.
  if (!out.length || weak > found.lines.length / 3) return { ok: false, reason: "the model couldn't read the lines" };
  return { ok: true, text: out.join("\n") };
}
