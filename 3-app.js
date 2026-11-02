import * as tf from "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.1.0/+esm";

const els = {
  dropSection: document.getElementById("drop-section"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  setupSection: document.getElementById("setup-section"),
  imgPreview: document.getElementById("img-preview"),
  inputBadge: document.getElementById("input-badge"),
  estNote: document.getElementById("est-note"),
  start: document.getElementById("start"),
  changePhoto: document.getElementById("change-photo"),
  workStatus: document.getElementById("work-status"),
  workTitle: document.getElementById("work-status-title"),
  workDetail: document.getElementById("work-status-detail"),
  progressFill: document.getElementById("progress-fill"),
  resultSection: document.getElementById("result-section"),
  engineBadge: document.getElementById("engine-badge"),
  compare: document.getElementById("compare"),
  afterWrap: document.getElementById("after-wrap"),
  imgBefore: document.getElementById("img-before"),
  imgAfter: document.getElementById("img-after"),
  slider: document.getElementById("slider"),
  sliderLine: document.querySelector(".slider-line"),
  resultBadge: document.getElementById("result-badge"),
  download: document.getElementById("download"),
  newPhoto: document.getElementById("new-photo"),
};

const MODEL_URLS = {
  fast: {
    "2": "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/models/x2/model.json",
    "4": "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@1.0.0/models/x4/model.json",
  },
  hq: {
    "2": "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0/models/x2/model.json",
    "4": "https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-medium@1.0.0/models/x4/model.json",
  },
};
const loadedModels = new Map();
async function getModel(quality, scale) {
  const key = quality + "-" + scale;
  if (!loadedModels.has(key)) loadedModels.set(key, tf.loadLayersModel(MODEL_URLS[quality][scale]));
  return loadedModels.get(key);
}
const TILE = 96, PAD = 16;
const MAX_SIDE = 1600;
let objectUrl = null;
let srcImg = null;        // HTMLImageElement (original)
let resultDataUrl = null; // upscaled PNG data URL
let busy = false;

function setProgress(f) {
  els.progressFill.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%";
}
function showWork(title, detail) {
  els.workStatus.classList.remove("hidden", "error");
  els.workTitle.textContent = title;
  els.workDetail.textContent = detail;
}
function showError(msg) {
  els.workStatus.classList.remove("hidden");
  els.workStatus.classList.add("error");
  els.workTitle.textContent = "Something went wrong";
  els.workDetail.textContent = msg;
}

function acceptFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (Math.max(img.naturalWidth, img.naturalHeight) > MAX_SIDE) {
      showError(`This photo is ${img.naturalWidth}x${img.naturalHeight}. Please use one up to ${MAX_SIDE}px on the long side - bigger inputs get very slow in a browser.`);
      return;
    }
    srcImg = img;
    els.imgPreview.src = objectUrl;
    els.inputBadge.textContent = `${img.naturalWidth} x ${img.naturalHeight}`;
    els.estNote.textContent = "First run downloads the AI model (a few MB, cached after). Processing time depends on your device - seconds on a GPU, longer on CPU.";
    els.dropSection.classList.add("hidden");
    els.resultSection.classList.add("hidden");
    els.workStatus.classList.add("hidden");
    els.setupSection.classList.remove("hidden");
  };
  img.onerror = () => showError("Could not read that image file.");
  img.src = objectUrl;
}

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") els.fileInput.click(); });
els.fileInput.addEventListener("change", () => acceptFile(els.fileInput.files[0]));
["dragover", "dragenter"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove("dragover"); }));
els.dropzone.addEventListener("drop", (e) => acceptFile(e.dataTransfer.files[0]));
window.addEventListener("paste", (e) => {
  const f = [...(e.clipboardData?.files || [])][0];
  if (f) acceptFile(f);
});

els.changePhoto.addEventListener("click", reset);
els.newPhoto.addEventListener("click", reset);
function reset() {
  els.setupSection.classList.add("hidden");
  els.resultSection.classList.add("hidden");
  els.workStatus.classList.add("hidden");
  els.dropSection.classList.remove("hidden");
  srcImg = null; resultDataUrl = null;
  els.fileInput.value = "";
}

els.start.addEventListener("click", async () => {
  if (busy || !srcImg) return;
  busy = true;
  const scale = Number(document.querySelector('input[name="scale"]:checked').value);
  const quality = document.querySelector('input[name="quality"]:checked').value;
  try {
    els.setupSection.classList.add("hidden");
    showWork("Loading the AI model", "First run downloads a few MB; cached by your browser afterwards.");
    setProgress(0.02);
    const t0 = performance.now();
    await tf.ready();
    const model = await getModel(quality, String(scale));

    const W = srcImg.naturalWidth, H = srcImg.naturalHeight;
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = W; srcCanvas.height = H;
    srcCanvas.getContext("2d").drawImage(srcImg, 0, 0);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = W * scale; outCanvas.height = H * scale;
    const outCtx = outCanvas.getContext("2d");
    const tileCanvas = document.createElement("canvas");

    const xs = [], ys = [];
    for (let x = 0; x < W; x += TILE) xs.push(x);
    for (let y = 0; y < H; y += TILE) ys.push(y);
    const total = xs.length * ys.length;
    let doneTiles = 0;

    showWork("Upscaling", "The model is enhancing your photo patch by patch.");
    for (const y of ys) {
      for (const x of xs) {
        const cw = Math.min(TILE, W - x), ch = Math.min(TILE, H - y);
        const sx = Math.max(0, x - PAD), sy = Math.max(0, y - PAD);
        const ex = Math.min(W, x + cw + PAD), ey = Math.min(H, y + ch + PAD);
        const pw = ex - sx, ph = ey - sy;
        const res = tf.tidy(() => {
          const patch = tf.browser.fromPixels(srcCanvas, 3)
            .slice([sy, sx, 0], [ph, pw, 3])
            .toFloat().div(255).expandDims(0);
          const pred = model.predict(patch);
          return pred.squeeze().clipByValue(0, 1).mul(255).toInt();
        });
        const px0 = (x - sx) * scale, py0 = (y - sy) * scale;
        const cx = cw * scale, cy = ch * scale;
        const center = res.slice([py0, px0, 0], [cy, cx, 3]);
        res.dispose();
        tileCanvas.width = cx; tileCanvas.height = cy;
        await tf.browser.toPixels(center, tileCanvas);
        center.dispose();
        outCtx.drawImage(tileCanvas, x * scale, y * scale);
        doneTiles++;
        setProgress(0.05 + (doneTiles / total) * 0.93);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    resultDataUrl = outCanvas.toDataURL("image/png");
    setProgress(1);
    const secs = Math.round((performance.now() - t0) / 1000);
    els.imgBefore.src = objectUrl;
    els.imgAfter.src = resultDataUrl;
    els.engineBadge.textContent = `${scale}x Real-ESRGAN ${quality === 'hq' ? 'high quality' : 'fast'}`;
    els.resultBadge.textContent = `${W}x${H} -> ${outCanvas.width}x${outCanvas.height} in ${secs}s`;
    els.workStatus.classList.add("hidden");
    els.compare.style.maxWidth = outCanvas.width + "px";
    els.resultSection.classList.remove("hidden");
    requestAnimationFrame(syncCompareHeight);
    window.__UPSCALER_DONE__ = true;
  } catch (err) {
    console.error(err);
    showError("Upscaling failed. Try a smaller photo, or a browser with WebGL (Chrome or Edge).");
  } finally {
    busy = false;
  }
});

function syncCompareHeight() {
  // size the compare box to the result image aspect
  const w = els.imgAfter.naturalWidth, h = els.imgAfter.naturalHeight;
  if (w && h) els.compare.style.aspectRatio = `${w} / ${h}`;
  els.imgBefore.style.width = "100%";
  els.imgBefore.style.height = "100%";
  els.imgBefore.style.objectFit = "cover";
  els.imgAfter.style.width = "100%";
  els.imgAfter.style.height = "100%";
  els.imgAfter.style.objectFit = "cover";
}

function updateSlider() {
  const pct = Number(els.slider.value);
  els.afterWrap.style.clipPath = `inset(0 0 0 ${pct}%)`;
  els.sliderLine.style.left = pct + "%";
}
els.slider.addEventListener("input", updateSlider);
updateSlider();

els.download.addEventListener("click", () => {
  if (!resultDataUrl) return;
  const a = document.createElement("a");
  a.href = resultDataUrl;
  a.download = "upscaled.png";
  a.click();
});
