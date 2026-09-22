/* Real-time face-tracking camera filters, built on face-api.js (loaded via CDN in app.html).
   Exposes window.SnapFilters. All drawing happens in the video's native (unmirrored) pixel
   space; the caller's canvas context is expected to already carry the mirror transform when
   the front camera is active, so filter graphics land in the same place as the mirrored video. */
(function () {
  // The maintainer's own GitHub Pages host for pretrained weights — more reliable than
  // proxying raw files out of the repo via jsdelivr's /gh/ endpoint.
  const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

  const FILTERS = [
    { id: 'none', emoji: '🚫', label: 'Yok' },
    { id: 'glasses', emoji: '😎', label: 'Gözlük' },
    { id: 'flowers', emoji: '🌸', label: 'Çiçek Taç' },
    { id: 'dog', emoji: '🐶', label: 'Köpek' },
    { id: 'cat', emoji: '🐱', label: 'Kedi' },
    { id: 'bunny', emoji: '🐰', label: 'Tavşan' },
    { id: 'mustache', emoji: '👨', label: 'Bıyık' },
    { id: 'crown', emoji: '👑', label: 'Taç', plus: true },
    { id: 'halo', emoji: '😇', label: 'Melek', plus: true },
    { id: 'devil', emoji: '😈', label: 'Şeytan', plus: true },
    { id: 'fire', emoji: '🔥', label: 'Alev', plus: true },
  ];

  let modelsLoaded = false;
  let modelsLoading = null;

  async function loadModels() {
    if (modelsLoaded) return true;
    if (modelsLoading) return modelsLoading;
    modelsLoading = (async () => {
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
      modelsLoaded = true;
      return true;
    })().catch((err) => {
      modelsLoading = null;
      throw err;
    });
    return modelsLoading;
  }

  function avgPoint(points) {
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x, y };
  }

  function drawGlasses(ctx, lm) {
    const pts = lm.positions;
    const rightEye = avgPoint(pts.slice(36, 42));
    const leftEye = avgPoint(pts.slice(42, 48));
    const center = { x: (rightEye.x + leftEye.x) / 2, y: (rightEye.y + leftEye.y) / 2 };
    const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
    const size = eyeDist * 2.6;
    const angle = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(angle);
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('😎', 0, 0);
    ctx.restore();
  }

  function drawFlowers(ctx, lm) {
    const pts = lm.positions;
    const browLeft = pts[17];
    const browRight = pts[26];
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const browTop = avgPoint(pts.slice(17, 27));
    const foreheadY = browTop.y - faceWidth * 0.35;
    const size = faceWidth * 0.3;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = browLeft.x + (browRight.x - browLeft.x) * t;
      const y = foreheadY + Math.sin(t * Math.PI) * -faceWidth * 0.08;
      ctx.save();
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🌸', x, y);
      ctx.restore();
    }
  }

  function earPath(ctx, x, earY, earSize, dir) {
    ctx.beginPath();
    ctx.moveTo(x, earY + earSize * 0.9);
    ctx.quadraticCurveTo(x + dir * earSize * 0.6, earY - earSize * 0.2, x + dir * earSize * 0.15, earY - earSize * 0.9);
    ctx.quadraticCurveTo(x - dir * earSize * 0.35, earY - earSize * 0.3, x, earY + earSize * 0.9);
    ctx.closePath();
  }

  function drawDog(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const nose = pts[33];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const earSize = faceWidth * 0.28;
    const earY = browTop.y - faceWidth * 0.45;

    ctx.save();
    ctx.fillStyle = '#6b4423';
    earPath(ctx, jawLeft.x + faceWidth * 0.05, earY, earSize, -1);
    ctx.fill();
    earPath(ctx, jawRight.x - faceWidth * 0.05, earY, earSize, 1);
    ctx.fill();
    ctx.restore();

    const noseSize = faceWidth * 0.16;
    ctx.save();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(nose.x, nose.y, noseSize, noseSize * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCat(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const nose = pts[33];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);

    const earSize = faceWidth * 0.3;
    const earY = browTop.y - faceWidth * 0.4;
    ctx.save();
    ctx.fillStyle = '#33302e';
    [jawLeft.x + faceWidth * 0.08, jawRight.x - faceWidth * 0.08].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x - earSize * 0.35, earY + earSize * 0.6);
      ctx.lineTo(x + earSize * 0.35, earY + earSize * 0.6);
      ctx.lineTo(x, earY - earSize * 0.7);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#ff8fab';
    const ns = faceWidth * 0.06;
    ctx.beginPath();
    ctx.moveTo(nose.x, nose.y - ns);
    ctx.lineTo(nose.x - ns, nose.y + ns * 0.6);
    ctx.lineTo(nose.x + ns, nose.y + ns * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1.5, faceWidth * 0.01);
    const cheekY = nose.y + faceWidth * 0.05;
    [-1, 1].forEach((dir) => {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        const startX = nose.x + dir * faceWidth * 0.12;
        const startY = cheekY + i * faceWidth * 0.04;
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + dir * faceWidth * 0.28, startY + i * faceWidth * 0.03);
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function drawMustache(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const noseBottom = pts[33];
    const mouthTop = avgPoint(pts.slice(48, 55));
    const center = { x: (noseBottom.x + mouthTop.x) / 2, y: (noseBottom.y + mouthTop.y) / 2 };
    const width = faceWidth * 0.5;
    const height = faceWidth * 0.11;

    ctx.save();
    ctx.fillStyle = '#2b1a10';
    [-1, 1].forEach((dir) => {
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - height * 0.3);
      ctx.quadraticCurveTo(
        center.x + dir * width * 0.25, center.y - height * 1.1,
        center.x + dir * width * 0.5, center.y - height * 0.2
      );
      ctx.quadraticCurveTo(
        center.x + dir * width * 0.32, center.y + height * 0.35,
        center.x, center.y + height * 0.25
      );
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBunny(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const nose = pts[33];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);

    const earW = faceWidth * 0.16;
    const earH = faceWidth * 0.55;
    const earY = browTop.y - faceWidth * 0.15;
    [jawLeft.x + faceWidth * 0.1, jawRight.x - faceWidth * 0.1].forEach((x) => {
      ctx.save();
      ctx.fillStyle = '#f5f0eb';
      ctx.beginPath();
      ctx.ellipse(x, earY - earH * 0.5, earW * 0.5, earH * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff9db3';
      ctx.beginPath();
      ctx.ellipse(x, earY - earH * 0.5, earW * 0.26, earH * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    const ns = faceWidth * 0.05;
    ctx.save();
    ctx.fillStyle = '#ff8fab';
    ctx.beginPath();
    ctx.ellipse(nose.x, nose.y, ns, ns * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCrown(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const size = faceWidth * 0.95;
    const y = browTop.y - faceWidth * 0.42;
    ctx.save();
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', (jawLeft.x + jawRight.x) / 2, y);
    ctx.restore();
  }

  function drawHalo(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const cx = (jawLeft.x + jawRight.x) / 2;
    const cy = browTop.y - faceWidth * 0.55;
    ctx.save();
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = Math.max(2, faceWidth * 0.035);
    ctx.shadowColor = 'rgba(255,215,0,0.7)';
    ctx.shadowBlur = faceWidth * 0.06;
    ctx.beginPath();
    ctx.ellipse(cx, cy, faceWidth * 0.28, faceWidth * 0.08, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDevil(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const hornSize = faceWidth * 0.22;
    const hornY = browTop.y - faceWidth * 0.32;
    ctx.save();
    ctx.fillStyle = '#c81e1e';
    [
      { x: jawLeft.x + faceWidth * 0.18, dir: -1 },
      { x: jawRight.x - faceWidth * 0.18, dir: 1 },
    ].forEach(({ x, dir }) => {
      ctx.beginPath();
      ctx.moveTo(x - hornSize * 0.3, hornY + hornSize * 0.5);
      ctx.quadraticCurveTo(x + dir * hornSize * 0.5, hornY, x + dir * hornSize * 0.1, hornY - hornSize * 0.9);
      ctx.quadraticCurveTo(x + dir * hornSize * 0.05, hornY - hornSize * 0.3, x + hornSize * 0.3, hornY + hornSize * 0.5);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  function drawFire(ctx, lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const browTop = avgPoint(pts.slice(17, 27));
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    const foreheadY = browTop.y - faceWidth * 0.35;
    const size = faceWidth * 0.32;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = jawLeft.x + faceWidth * 0.1 + (jawRight.x - jawLeft.x - faceWidth * 0.2) * t;
      const y = foreheadY + Math.sin(t * Math.PI) * -faceWidth * 0.1;
      ctx.save();
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔥', x, y);
      ctx.restore();
    }
  }

  const DRAWERS = {
    glasses: drawGlasses,
    flowers: drawFlowers,
    dog: drawDog,
    cat: drawCat,
    bunny: drawBunny,
    mustache: drawMustache,
    crown: drawCrown,
    halo: drawHalo,
    devil: drawDevil,
    fire: drawFire,
  };

  let running = false;
  let detecting = false;
  let lastLandmarks = null;
  let rafId = null;
  let detectIntervalId = null;
  let ctx = null;
  let videoEl = null;
  let canvasEl = null;
  let getFilterId = () => 'none';
  let getFacingMode = () => 'user';

  async function detectTick() {
    if (!running || !modelsLoaded || detecting) return;
    if (getFilterId() === 'none' || videoEl.readyState < 2) return;
    detecting = true;
    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
      const result = await faceapi.detectSingleFace(videoEl, options).withFaceLandmarks(true);
      lastLandmarks = result ? result.landmarks : null;
    } catch (e) {
      // transient detection errors are fine to skip
    }
    detecting = false;
  }

  function renderFrame() {
    if (!running) return;
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.save();
    if (getFacingMode() === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    const filterId = getFilterId();
    if (filterId !== 'none' && lastLandmarks) {
      const drawer = DRAWERS[filterId];
      if (drawer) drawer(ctx, lastLandmarks);
    }
    ctx.restore();
    rafId = requestAnimationFrame(renderFrame);
  }

  window.SnapFilters = {
    list: FILTERS,
    loadModels,
    isLoaded: () => modelsLoaded,
    start(video, canvas, opts) {
      videoEl = video;
      canvasEl = canvas;
      ctx = canvas.getContext('2d');
      getFilterId = (opts && opts.getFilterId) || (() => 'none');
      getFacingMode = (opts && opts.getFacingMode) || (() => 'user');
      lastLandmarks = null;
      running = true;
      detectIntervalId = setInterval(detectTick, 120);
      rafId = requestAnimationFrame(renderFrame);
    },
    stop() {
      running = false;
      lastLandmarks = null;
      if (rafId) cancelAnimationFrame(rafId);
      if (detectIntervalId) clearInterval(detectIntervalId);
      rafId = null;
      detectIntervalId = null;
    },
  };
})();
