// Shared photo/video intake for uploads (Today proof photos, Communities posts).
// Declares isImageFile / isVideoFile / downscale / checkVideo, so pages must not
// declare those themselves.
//
// HEIC/HEIF (iPhone photos): Safari decodes them natively. Other browsers can't,
// so on a failed decode we lazy-load heic2any (~1.3 MB, fetched only when needed)
// to convert to JPEG, then downscale as usual.

const HEIC_RE = /\.(heic|heif)$/i;
const HEIC2ANY_SRC = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

// Some browsers (Chrome on Windows, Firefox) report HEIC files with an empty type.
const isHeic = (f) => /^image\/hei[cf]/i.test(f.type) || HEIC_RE.test(f.name);
const isImageFile = (f) => f.type.startsWith("image/") || isHeic(f);
const isVideoFile = (f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(f.name);

let heic2anyLoad = null;
function loadHeic2any() {
  heic2anyLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HEIC2ANY_SRC;
    s.onload = () => resolve(window.heic2any);
    s.onerror = () => { heic2anyLoad = null; reject(new Error("Couldn't load the HEIC converter. Check your connection and try again.")); };
    document.head.append(s);
  });
  return heic2anyLoad;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => (URL.revokeObjectURL(url), resolve(im));
    im.onerror = () => (URL.revokeObjectURL(url), reject(new Error("That file isn't an image we can read.")));
    im.src = url;
  });
}

// Images are downscaled to JPEG data URLs (they're stored in localStorage or uploaded).
async function downscale(file, max = 1280) {
  let im;
  try {
    im = await loadImage(file);
  } catch (err) {
    if (!isHeic(file)) throw err;
    const heic2any = await loadHeic2any();
    let jpeg = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    if (Array.isArray(jpeg)) jpeg = jpeg[0]; // multi-image HEIC (bursts, Live Photo stills)
    im = await loadImage(jpeg);
  }
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = Math.round(im.naturalWidth * k);
  cv.height = Math.round(im.naturalHeight * k);
  cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.82);
}

// Resolves if this browser can play the video. iPhone videos are often HEVC (H.265)
// .mov files, which Firefox and some Chrome/Windows setups can't decode. Converting
// in the browser would need ffmpeg.wasm (~30 MB), so we explain instead.
function checkVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto"; // loadeddata needs a decoded frame, which proves the codec works
    v.muted = true;
    const done = (ok) => { v.removeAttribute("src"); v.load(); ok ? resolve() : reject(new Error(
      "This browser can't play that video (likely HEVC from an iPhone). Try Safari, or on iPhone set Settings → Camera → Formats → Most Compatible.")); };
    v.onloadeddata = () => done(v.videoWidth > 0);
    v.onerror = () => done(false);
    setTimeout(() => done(v.readyState >= 1 && v.videoWidth > 0), 8000);
    v.src = url;
  });
}
