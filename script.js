// ================= CONFIG & STATE =================
const STEP_ORDER = ['mode', 'frame', 'capture', 'preview', 'filter', 'result'];

const BACK_MAP = {
  mode: null,
  frame: 'mode',
  capture: 'frame',
  preview: null,   // xem lại xong không cho quay lại chụp (đúng theo flow đã chốt)
  filter: 'preview',
  result: null,
};

const FILTERS = [
  { id: 'original', name: 'Nguyên bản', css: 'none' },
  { id: 'korean', name: 'Korean Bright', css: 'brightness(1.1) contrast(0.95) saturate(1.05)' },
  { id: 'pink', name: 'Pink Dreamy', css: 'sepia(0.15) saturate(1.3) hue-rotate(-10deg) brightness(1.08)' },
  { id: 'cream', name: 'Cream Soft', css: 'brightness(1.05) contrast(0.9) saturate(0.9) sepia(0.1)' },
  { id: 'vintage', name: 'Vintage Film', css: 'contrast(1.1) saturate(0.8) sepia(0.2)' },
  { id: 'bw', name: 'Black & White', css: 'grayscale(1) contrast(1.1)' },
  { id: 'vivid', name: 'Vivid Pop', css: 'saturate(1.4) contrast(1.1) brightness(1.05)' },
];

let FRAMES_CONFIG = null;

const state = {
  mode: null,
  totalShots: 1,
  frameId: null,
  frameDef: null,
  rawPhotos: [],
  filteredPhotos: [],
  selectedFilter: 'original',
  selectedPreviewIndex: 0,
  framedResultURL: null,
  cameraStream: null,
  isCapturing: false,
  currentStep: 'mode',
};

// ================= DOM SHORTCUTS =================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const videoEl = $('#camera-video');
const viewfinderEl = $('#viewfinder');
const stageImageEl = $('#stage-image');
const stageCaptionEl = $('#stage-caption');
const countdownOverlay = $('#countdown-overlay');
const flashOverlay = $('#flash-overlay');
const shotCounterEl = $('#shot-counter');
const shutterBtn = $('#shutter-btn');
const shutterLabelEl = $('#shutter-label');
const backBtn = $('#back-btn');
const ghostGridEl = $('#ghost-grid');
const frameGhostImg = $('#frame-ghost-img');
const shotThumbsEl = $('#shot-thumbs');

// ================= UTILITIES =================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const targetRatio = w / h;
  const srcRatio = iw / ih;
  let sx, sy, sw, sh;
  if (srcRatio > targetRatio) {
    sh = ih; sw = ih * targetRatio; sx = (iw - sw) / 2; sy = 0;
  } else {
    sw = iw; sh = iw / targetRatio; sx = 0; sy = (ih - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function dataURLToUint8(dataURL) {
  const base64 = dataURL.split(',')[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function setStageImage(src, filterCss) {
  stageImageEl.src = src || '';
  stageImageEl.style.filter = filterCss || 'none';
}

function setGhostGrid(cells) {
  ghostGridEl.innerHTML = '';
  ghostGridEl.classList.add('show');
  if (cells <= 1) {
    ghostGridEl.style.gridTemplateColumns = '1fr';
    ghostGridEl.style.gridTemplateRows = '1fr';
    const c = document.createElement('div');
    c.className = 'cell';
    ghostGridEl.appendChild(c);
  } else {
    ghostGridEl.style.gridTemplateColumns = 'repeat(3, 1fr)';
    ghostGridEl.style.gridTemplateRows = 'repeat(2, 1fr)';
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('div');
      c.className = 'cell';
      ghostGridEl.appendChild(c);
    }
  }
}

function setFrameGhost(src) {
  frameGhostImg.src = src;
  frameGhostImg.classList.add('show');
}

// ================= STEP META (drives shutter + captions) =================
const STEP_META = {
  mode: {
    caption: 'Chọn kiểu chụp bên trái để bắt đầu',
    shutterLabel: 'Tiếp tục',
    canProceed: () => !!state.mode,
    onShutter: () => goToStep('frame'),
  },
  frame: {
    caption: 'Chọn khung, bạn sẽ thấy khung phủ thử lên hình',
    shutterLabel: 'Bắt đầu chụp',
    canProceed: () => !!state.frameId,
    onShutter: () => goToStep('capture'),
  },
  capture: {
    caption: 'Nhấn nút để camera đếm ngược 5 giây rồi chụp',
    shutterLabel: 'Bắt đầu đếm ngược',
    canProceed: () => !state.isCapturing,
    onShutter: () => runCaptureSequence(),
  },
  preview: {
    caption: 'Xem lại ảnh, không chỉnh sửa được nữa nhé',
    shutterLabel: 'Tiếp tục chọn màu',
    canProceed: () => true,
    onShutter: () => goToStep('filter'),
  },
  filter: {
    caption: 'Chọn 1 tông màu, xem trước ngay bên phải',
    shutterLabel: 'Xác nhận',
    canProceed: () => true,
    onShutter: () => confirmFilterAndCompose(),
  },
  result: {
    hideShutter: true,
    caption: 'Tải về hoặc in ảnh của bạn ở bên trái',
  },
};

// ================= NAVIGATION =================
function goToStep(name) {
  if (name === 'frame' && FRAMES_CONFIG) buildFrameList();
  if (name === 'preview' && state.rawPhotos.length) buildPreviewList();
  if (name === 'filter' && state.rawPhotos.length) buildFilterList();

  state.currentStep = name;
  viewfinderEl.dataset.active = name;

  $$('.sidebar-panel').forEach((p) => p.classList.toggle('active', p.dataset.step === name));

  const idx = STEP_ORDER.indexOf(name);
  $$('.rail-step').forEach((el) => {
    const stepIdx = STEP_ORDER.indexOf(el.dataset.step);
    el.classList.toggle('active', stepIdx === idx);
    el.classList.toggle('done', stepIdx < idx);
  });

  const meta = STEP_META[name];
  stageCaptionEl.textContent = meta.caption;
  if (meta.hideShutter) {
    shutterBtn.hidden = true;
  } else {
    shutterBtn.hidden = false;
    shutterLabelEl.textContent = meta.shutterLabel;
    shutterBtn.disabled = !meta.canProceed();
  }

  const backTarget = BACK_MAP[name];
  backBtn.hidden = !backTarget;
  backBtn.disabled = state.isCapturing;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshShutter() {
  const meta = STEP_META[state.currentStep];
  if (!meta || meta.hideShutter) return;
  shutterBtn.disabled = !meta.canProceed();
}

shutterBtn.addEventListener('click', () => {
  const meta = STEP_META[state.currentStep];
  if (meta && meta.onShutter) meta.onShutter();
});

backBtn.addEventListener('click', () => {
  const target = BACK_MAP[state.currentStep];
  if (target) goToStep(target);
});

// ================= LOAD CONFIG + CAMERA (started early) =================
async function init() {
  try {
    const res = await fetch('frames/frames-config.json');
    FRAMES_CONFIG = await res.json();
  } catch (e) {
    console.error('Không tải được frames-config.json', e);
    alert('Không tải được cấu hình khung ảnh. Nếu bạn đang mở file trực tiếp (file://), hãy chạy qua một local server (vd: `npx serve`) rồi thử lại.');
  }
  goToStep('mode');
  await initCamera();
}

async function initCamera() {
  stopCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1536 }, height: { ideal: 1024 } },
      audio: false,
    });
    state.cameraStream = stream;
    videoEl.srcObject = stream;
  } catch (e) {
    console.error(e);
    stageCaptionEl.textContent = 'Không thể truy cập camera. Vui lòng cho phép quyền camera rồi tải lại trang.';
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
  }
}

// ================= STEP 1: MODE =================
$$('.option-row[data-mode]').forEach((row) => {
  row.addEventListener('click', () => {
    $$('.option-row[data-mode]').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    state.mode = row.dataset.mode;
    state.totalShots = state.mode === 'single' ? 1 : 6;
    setGhostGrid(state.totalShots);
    refreshShutter();
  });
});

// ================= STEP 2: FRAME =================
function buildFrameList() {
  const list = $('#frame-list');
  list.innerHTML = '';
  const group = FRAMES_CONFIG[state.mode];
  Object.entries(group).forEach(([id, def]) => {
    const row = document.createElement('button');
    row.className = 'frame-thumb-row';
    row.dataset.frameId = id;
    row.innerHTML = `<img src="${def.file}" alt="${def.label}" loading="lazy" /><span>${def.label}</span>`;
    row.addEventListener('click', () => {
      $$('.frame-thumb-row', list).forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      state.frameId = id;
      state.frameDef = def;
      setFrameGhost(def.file);
      refreshShutter();
    });
    list.appendChild(row);
  });
}

// ================= STEP 3: CAPTURE =================
function captureFrame() {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.95);
}

function countdownFrom(seconds) {
  return new Promise((resolve) => {
    let c = seconds;
    countdownOverlay.textContent = c;
    countdownOverlay.classList.add('show');
    const timer = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(timer);
        countdownOverlay.classList.remove('show');
        resolve();
      } else {
        countdownOverlay.textContent = c;
      }
    }, 1000);
  });
}

function renderShotThumbs() {
  shotThumbsEl.innerHTML = '';
  for (let i = 0; i < state.totalShots; i++) {
    if (state.rawPhotos[i]) {
      const img = document.createElement('img');
      img.src = state.rawPhotos[i];
      shotThumbsEl.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'slot-empty';
      shotThumbsEl.appendChild(empty);
    }
  }
}

async function doFlashAndCapture() {
  const dataURL = captureFrame();
  flashOverlay.classList.remove('flash');
  void flashOverlay.offsetWidth;
  flashOverlay.classList.add('flash');
  state.rawPhotos.push(dataURL);
  renderShotThumbs();
}

async function runCaptureSequence() {
  state.isCapturing = true;
  state.rawPhotos = [];
  renderShotThumbs();
  shutterBtn.disabled = true;
  backBtn.disabled = true;

  for (let i = 1; i <= state.totalShots; i++) {
    shotCounterEl.textContent = `Tấm ${i}/${state.totalShots}`;
    stageCaptionEl.textContent = i === 1 ? 'Tạo dáng đi nào!' : 'Tạo dáng tiếp nào!';
    await countdownFrom(5);
    await doFlashAndCapture();
    if (i < state.totalShots) {
      stageCaptionEl.textContent = 'Nghỉ giây lát, chuẩn bị tấm tiếp theo...';
      await sleep(3000);
    }
  }

  stageCaptionEl.textContent = 'Xong rồi!';
  stopCamera();
  state.isCapturing = false;
  state.selectedPreviewIndex = 0;
  goToStep('preview');
}

// ================= STEP 4: PREVIEW (no retake) =================
function buildPreviewList() {
  const list = $('#preview-list');
  list.innerHTML = '';
  state.rawPhotos.forEach((url, i) => {
    const row = document.createElement('button');
    row.className = 'frame-thumb-row' + (i === state.selectedPreviewIndex ? ' selected' : '');
    row.innerHTML = `<img src="${url}" alt="Tấm ${i + 1}" /><span>Tấm ${i + 1}</span>`;
    row.addEventListener('click', () => {
      $$('.frame-thumb-row', list).forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      state.selectedPreviewIndex = i;
      setStageImage(url);
    });
    list.appendChild(row);
  });
  setStageImage(state.rawPhotos[0]);
}

// ================= STEP 5: FILTER =================
function buildFilterList() {
  const list = $('#filter-list');
  list.innerHTML = '';
  const sampleURL = state.rawPhotos[state.selectedPreviewIndex] || state.rawPhotos[0];
  FILTERS.forEach((f) => {
    const row = document.createElement('button');
    row.className = 'filter-row' + (f.id === state.selectedFilter ? ' selected' : '');
    row.innerHTML = `<img class="swatch" src="${sampleURL}" style="filter:${f.css}" alt="${f.name}" /><span>${f.name}</span>`;
    row.addEventListener('click', () => {
      $$('.filter-row', list).forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      state.selectedFilter = f.id;
      setStageImage(sampleURL, f.css);
    });
    list.appendChild(row);
  });
  setStageImage(sampleURL, FILTERS.find((f) => f.id === state.selectedFilter).css);
}

async function bakeFilter(dataURL, cssFilter) {
  const img = await loadImage(dataURL);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.filter = cssFilter === 'none' ? 'none' : cssFilter;
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

// Chuyển vùng trắng thuần bên trong TỪNG Ô (theo đúng tọa độ đã đo trong
// frames-config.json) thành trong suốt, để khi vẽ đè lên ảnh chụp, các chi
// tiết trang trí (vạch nét đứt, viền, sticker) nằm NGOÀI vùng trắng đó vẫn
// hiện trên cùng — không đụng tới các điểm trắng khác trong khung (chim,
// hạt sáng...) vì chỉ xử lý pixel bên trong bounding box của từng ô.
// Bỏ xử lý flood fill runtime vì đã được chuyển sang script python offline (punchframes.py)
// Khung ảnh PNG được đục lỗ sẵn, chỉ việc vẽ đè lên.

async function composeFramed(frameDef, photoURLs) {
  const canvas = document.createElement('canvas');
  canvas.width = FRAMES_CONFIG.canvasWidth;
  canvas.height = FRAMES_CONFIG.canvasHeight;
  const ctx = canvas.getContext('2d');

  // 1. Vẽ ảnh chụp vào đúng vị trí từng ô TRƯỚC (lớp dưới cùng)
  for (let i = 0; i < frameDef.slots.length; i++) {
    const slot = frameDef.slots[i];
    const url = photoURLs[i];
    if (!url) continue;
    const img = await loadImage(url);
    ctx.save();
    roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, frameDef.radius || 20);
    ctx.clip();
    drawImageCover(ctx, img, slot.x, slot.y, slot.w, slot.h);
    ctx.restore();
  }

  // 2. Đè khung PNG đã đục lỗ sẵn lên trên (lớp trên)
  const frameImg = await loadImage(frameDef.file);
  ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}

async function confirmFilterAndCompose() {
  shutterBtn.disabled = true;
  shutterLabelEl.textContent = 'Đang xử lý...';
  const filterDef = FILTERS.find((f) => f.id === state.selectedFilter);

  state.filteredPhotos = await Promise.all(
    state.rawPhotos.map((url) => bakeFilter(url, filterDef.css))
  );
  state.framedResultURL = await composeFramed(state.frameDef, state.filteredPhotos);

  setStageImage(state.framedResultURL);
  goToStep('result');
}

// ================= STEP 6: RESULT (download / print / restart) =================
$('#btn-download').addEventListener('click', async () => {
  const btn = $('#btn-download');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang nén file...';
  try {
    const zip = new JSZip();
    if (state.mode === 'single') {
      zip.file('photo.jpg', dataURLToUint8(state.filteredPhotos[0]));
      zip.file('framed.png', dataURLToUint8(state.framedResultURL));
    } else {
      state.filteredPhotos.forEach((url, i) => {
        zip.file(`photo-${i + 1}.jpg`, dataURLToUint8(url));
      });
      zip.file('framed.png', dataURLToUint8(state.framedResultURL));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `photobooth-${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

$('#btn-print').addEventListener('click', () => {
  $('#print-image').src = state.framedResultURL;
  setTimeout(() => window.print(), 100);
});

$('#btn-restart').addEventListener('click', async () => {
  state.mode = null;
  state.totalShots = 1;
  state.frameId = null;
  state.frameDef = null;
  state.rawPhotos = [];
  state.filteredPhotos = [];
  state.selectedFilter = 'original';
  state.selectedPreviewIndex = 0;
  state.framedResultURL = null;

  $$('.option-row[data-mode]').forEach((r) => r.classList.remove('selected'));
  ghostGridEl.classList.remove('show');
  ghostGridEl.innerHTML = '';
  frameGhostImg.classList.remove('show');
  frameGhostImg.src = '';
  shotThumbsEl.innerHTML = '';

  goToStep('mode');
  await initCamera();
});

// ================= BOOT =================
init();