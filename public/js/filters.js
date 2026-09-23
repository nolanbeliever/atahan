/* Real-time face-tracking camera filters, built on face-api.js (loaded via CDN in app.html).
   Exposes window.SnapFilters. All drawing happens in the video's native (unmirrored) pixel
   space; the caller's canvas context is expected to already carry the mirror transform when
   the front camera is active, so filter graphics land in the same place as the mirrored video.

   Filters are built from a small set of reusable "engines" (floating emoji arc, eye accessory,
   head accessory, animal ears, mouth accessory, whole-frame color grade) configured with
   different params, rather than one bespoke drawing function per filter — that's what makes a
   catalog of ~65 filters maintainable. A handful of filters (halo/devil) still use fully custom
   vector drawing where an emoji/generic shape wouldn't read well. */
(function () {
  // The maintainer's own GitHub Pages host for pretrained weights — more reliable than
  // proxying raw files out of the repo via jsdelivr's /gh/ endpoint.
  const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

  function avgPoint(points) {
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x, y };
  }

  function faceMetrics(lm) {
    const pts = lm.positions;
    const jawLeft = pts[0];
    const jawRight = pts[16];
    const faceWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
    return {
      pts,
      jawLeft,
      jawRight,
      faceWidth,
      browTop: avgPoint(pts.slice(17, 27)),
      nose: pts[33],
      rightEye: avgPoint(pts.slice(36, 42)),
      leftEye: avgPoint(pts.slice(42, 48)),
      mouthTop: avgPoint(pts.slice(48, 55)),
    };
  }

  /* ---------- Engines ---------- */

  function engineEyeAccessory(ctx, lm, p) {
    const { rightEye, leftEye } = faceMetrics(lm);
    const center = { x: (rightEye.x + leftEye.x) / 2, y: (rightEye.y + leftEye.y) / 2 };
    const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
    const size = eyeDist * (p.scale || 2.6);
    const angle = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(angle);
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, 0, 0);
    ctx.restore();
  }

  function engineHeadAccessory(ctx, lm, p) {
    const { jawLeft, jawRight, browTop, faceWidth } = faceMetrics(lm);
    const size = faceWidth * (p.scale || 0.95);
    const y = browTop.y - faceWidth * (p.yOffset || 0.42);
    ctx.save();
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.emoji, (jawLeft.x + jawRight.x) / 2, y);
    ctx.restore();
  }

  function engineFloatingEmoji(ctx, lm, p) {
    const { jawLeft, jawRight, browTop, faceWidth } = faceMetrics(lm);
    const foreheadY = browTop.y - faceWidth * 0.35;
    const size = faceWidth * (p.size || 0.3);
    const count = p.count || 5;
    const margin = faceWidth * 0.1;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = jawLeft.x + margin + (jawRight.x - jawLeft.x - margin * 2) * t;
      const y = foreheadY + Math.sin(t * Math.PI) * -faceWidth * 0.08;
      ctx.save();
      ctx.font = `${size}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, x, y);
      ctx.restore();
    }
  }

  function earPath(ctx, x, earY, earSize, dir, shape) {
    ctx.beginPath();
    if (shape === 'pointy') {
      ctx.moveTo(x - earSize * 0.35, earY + earSize * 0.6);
      ctx.lineTo(x + earSize * 0.35, earY + earSize * 0.6);
      ctx.lineTo(x, earY - earSize * 0.7);
      ctx.closePath();
    } else if (shape === 'round') {
      ctx.ellipse(x, earY - earSize * 0.5, earSize * 0.45, earSize * 0.55, 0, 0, Math.PI * 2);
    } else {
      // floppy
      ctx.moveTo(x, earY + earSize * 0.9);
      ctx.quadraticCurveTo(x + dir * earSize * 0.6, earY - earSize * 0.2, x + dir * earSize * 0.15, earY - earSize * 0.9);
      ctx.quadraticCurveTo(x - dir * earSize * 0.35, earY - earSize * 0.3, x, earY + earSize * 0.9);
      ctx.closePath();
    }
  }

  function engineEarAccessory(ctx, lm, p) {
    const { jawLeft, jawRight, browTop, nose, faceWidth } = faceMetrics(lm);
    const earSize = faceWidth * (p.earSize || 0.28);
    const earY = browTop.y - faceWidth * (p.earY || 0.42);
    const inset = faceWidth * (p.inset || 0.07);

    ctx.save();
    ctx.fillStyle = p.outerColor;
    earPath(ctx, jawLeft.x + inset, earY, earSize, -1, p.shape);
    ctx.fill();
    earPath(ctx, jawRight.x - inset, earY, earSize, 1, p.shape);
    ctx.fill();
    if (p.innerColor) {
      ctx.fillStyle = p.innerColor;
      const innerScale = 0.55;
      ctx.save();
      ctx.translate(jawLeft.x + inset, earY - earSize * 0.15);
      ctx.scale(innerScale, innerScale);
      earPath(ctx, 0, 0, earSize, -1, p.shape);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(jawRight.x - inset, earY - earSize * 0.15);
      ctx.scale(innerScale, innerScale);
      earPath(ctx, 0, 0, earSize, 1, p.shape);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    if (p.noseColor) {
      const noseSize = faceWidth * (p.noseSize || 0.14);
      ctx.save();
      ctx.fillStyle = p.noseColor;
      if (p.noseShape === 'triangle') {
        ctx.beginPath();
        ctx.moveTo(nose.x, nose.y - noseSize * 0.6);
        ctx.lineTo(nose.x - noseSize * 0.6, nose.y + noseSize * 0.4);
        ctx.lineTo(nose.x + noseSize * 0.6, nose.y + noseSize * 0.4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(nose.x, nose.y, noseSize * 0.7, noseSize * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (p.whiskers) {
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
  }

  function engineMouthAccessory(ctx, lm, p) {
    const { faceWidth, nose, mouthTop } = faceMetrics(lm);
    const center = { x: (nose.x + mouthTop.x) / 2, y: (nose.y + mouthTop.y) / 2 };

    if (p.type === 'mustache') {
      const width = faceWidth * 0.5;
      const height = faceWidth * 0.11;
      ctx.save();
      ctx.fillStyle = p.color;
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
    } else if (p.type === 'fangs') {
      const size = faceWidth * 0.06;
      ctx.save();
      ctx.fillStyle = '#fff';
      [-1, 1].forEach((dir) => {
        const x = mouthTop.x + dir * faceWidth * 0.09;
        ctx.beginPath();
        ctx.moveTo(x - size * 0.4, mouthTop.y);
        ctx.lineTo(x + size * 0.4, mouthTop.y);
        ctx.lineTo(x, mouthTop.y + size * 1.4);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    } else if (p.type === 'lips') {
      ctx.save();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(2, faceWidth * 0.025);
      ctx.beginPath();
      ctx.ellipse(mouthTop.x, mouthTop.y + faceWidth * 0.03, faceWidth * 0.14, faceWidth * 0.05, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (p.type === 'circle-nose') {
      ctx.save();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(nose.x, nose.y, faceWidth * 0.09, faceWidth * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  const CSS_FILTERS = {
    grayscale: 'grayscale(1)',
    sepia: 'sepia(1)',
    invert: 'invert(0.9)',
    warm: 'sepia(0.35) saturate(1.5) hue-rotate(-8deg)',
    cold: 'hue-rotate(180deg) saturate(1.3)',
    neon: 'saturate(2.6) contrast(1.35) hue-rotate(15deg)',
    vintage: 'sepia(0.45) contrast(1.1) brightness(0.92)',
    highcontrast: 'contrast(1.8) saturate(1.4)',
    dreamy: 'blur(1.5px) brightness(1.15) saturate(1.2)',
    moody: 'contrast(1.3) brightness(0.78) saturate(0.65)',
    matrix: 'grayscale(0.6) sepia(1) hue-rotate(70deg) saturate(3) brightness(0.9)',
    cinematic: 'contrast(1.25) saturate(0.85) brightness(0.92) sepia(0.15)',
    pastel: 'saturate(0.6) brightness(1.15) contrast(0.9)',
  };

  // Custom, fully bespoke drawers for effects a generic engine can't express well.
  function drawHalo(ctx, lm) {
    const { jawLeft, jawRight, browTop, faceWidth } = faceMetrics(lm);
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
    const { jawLeft, jawRight, browTop, faceWidth } = faceMetrics(lm);
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

  const CUSTOM_DRAWERS = { halo: drawHalo, devil: drawDevil };

  /* ---------- Filter catalog ---------- */
  // id, emoji (chip icon), label, engine, params, plus (Snoop Plus exclusive)

  const FILTERS = [
    { id: 'none', emoji: '🚫', label: 'Yok' },

    // Eye accessories
    { id: 'glasses', emoji: '😎', label: 'Gözlük', engine: 'eyeAccessory', params: { emoji: '😎' } },
    { id: 'goggles', emoji: '🥽', label: 'Dalış Gözlüğü', engine: 'eyeAccessory', params: { emoji: '🥽' } },
    { id: 'nerd', emoji: '🤓', label: 'İnek Gözlüğü', engine: 'eyeAccessory', params: { emoji: '🤓' } },
    { id: 'heart-eyes', emoji: '😍', label: 'Kalp Gözler', engine: 'eyeAccessory', params: { emoji: '😍' } },
    { id: 'star-eyes', emoji: '🤩', label: 'Yıldız Gözler', engine: 'eyeAccessory', params: { emoji: '🤩' } },
    { id: 'wink', emoji: '😜', label: 'Göz Kırpma', engine: 'eyeAccessory', params: { emoji: '😜' } },
    { id: 'cool-shades', emoji: '🕶️', label: 'Havalı Gözlük', engine: 'eyeAccessory', params: { emoji: '🕶️' }, plus: true },

    // Head accessories
    { id: 'crown', emoji: '👑', label: 'Taç', engine: 'headAccessory', params: { emoji: '👑' }, plus: true },
    { id: 'halo', emoji: '😇', label: 'Melek', engine: 'custom', plus: true },
    { id: 'devil', emoji: '😈', label: 'Şeytan', engine: 'custom', plus: true },
    { id: 'tophat', emoji: '🎩', label: 'Silindir Şapka', engine: 'headAccessory', params: { emoji: '🎩' } },
    { id: 'cap', emoji: '🧢', label: 'Şapka', engine: 'headAccessory', params: { emoji: '🧢' } },
    { id: 'sunhat', emoji: '👒', label: 'Güneş Şapkası', engine: 'headAccessory', params: { emoji: '👒' } },
    { id: 'gradcap', emoji: '🎓', label: 'Mezuniyet Şapkası', engine: 'headAccessory', params: { emoji: '🎓' } },
    { id: 'helmet', emoji: '🪖', label: 'Asker Kaskı', engine: 'headAccessory', params: { emoji: '🪖' } },
    { id: 'santa', emoji: '🎅', label: 'Noel Baba', engine: 'headAccessory', params: { emoji: '🎅' } },
    { id: 'party-hat', emoji: '🥳', label: 'Parti', engine: 'headAccessory', params: { emoji: '🥳' } },
    { id: 'unicorn', emoji: '🦄', label: 'Tek Boynuz', engine: 'headAccessory', params: { emoji: '🦄', scale: 0.8 }, plus: true },
    { id: 'wizard', emoji: '🧙', label: 'Büyücü', engine: 'headAccessory', params: { emoji: '🧙' }, plus: true },

    // Floating emoji arcs
    { id: 'flowers', emoji: '🌸', label: 'Çiçek Taç', engine: 'floatingEmoji', params: { emoji: '🌸' } },
    { id: 'hearts', emoji: '❤️', label: 'Kalpler', engine: 'floatingEmoji', params: { emoji: '❤️' } },
    { id: 'stars', emoji: '⭐', label: 'Yıldızlar', engine: 'floatingEmoji', params: { emoji: '⭐' } },
    { id: 'clover', emoji: '🍀', label: 'Yonca', engine: 'floatingEmoji', params: { emoji: '🍀' } },
    { id: 'balloons', emoji: '🎈', label: 'Balonlar', engine: 'floatingEmoji', params: { emoji: '🎈' } },
    { id: 'confetti-f', emoji: '🎉', label: 'Konfeti', engine: 'floatingEmoji', params: { emoji: '🎉' } },
    { id: 'butterflies', emoji: '🦋', label: 'Kelebekler', engine: 'floatingEmoji', params: { emoji: '🦋' } },
    { id: 'candy', emoji: '🍭', label: 'Şeker', engine: 'floatingEmoji', params: { emoji: '🍭' } },
    { id: 'pumpkin', emoji: '🎃', label: 'Kabak', engine: 'floatingEmoji', params: { emoji: '🎃' } },
    { id: 'skull', emoji: '💀', label: 'Kafatası', engine: 'floatingEmoji', params: { emoji: '💀' } },
    { id: 'snow', emoji: '❄️', label: 'Kar', engine: 'floatingEmoji', params: { emoji: '❄️' } },
    { id: 'bees', emoji: '🐝', label: 'Arılar', engine: 'floatingEmoji', params: { emoji: '🐝' } },
    { id: 'mushrooms', emoji: '🍄', label: 'Mantarlar', engine: 'floatingEmoji', params: { emoji: '🍄' } },
    { id: 'fire', emoji: '🔥', label: 'Alev', engine: 'floatingEmoji', params: { emoji: '🔥' }, plus: true },
    { id: 'diamonds', emoji: '💎', label: 'Elmaslar', engine: 'floatingEmoji', params: { emoji: '💎' }, plus: true },
    { id: 'sparkles', emoji: '✨', label: 'Parıltı', engine: 'floatingEmoji', params: { emoji: '✨' }, plus: true },
    { id: 'glowstars', emoji: '🌟', label: 'Parlayan Yıldız', engine: 'floatingEmoji', params: { emoji: '🌟' }, plus: true },
    { id: 'rainbow-f', emoji: '🌈', label: 'Gökkuşağı', engine: 'floatingEmoji', params: { emoji: '🌈', count: 3 }, plus: true },

    // Animal ears
    { id: 'dog', emoji: '🐶', label: 'Köpek', engine: 'earAccessory', params: { shape: 'floppy', outerColor: '#6b4423', noseColor: '#1a1a1a', noseSize: 0.16 } },
    { id: 'cat', emoji: '🐱', label: 'Kedi', engine: 'earAccessory', params: { shape: 'pointy', outerColor: '#33302e', noseColor: '#ff8fab', noseShape: 'triangle', noseSize: 0.1, whiskers: true } },
    { id: 'bunny', emoji: '🐰', label: 'Tavşan', engine: 'earAccessory', params: { shape: 'round', earSize: 0.32, earY: 0.7, outerColor: '#f5f0eb', innerColor: '#ff9db3', noseColor: '#ff8fab', noseSize: 0.08 } },
    { id: 'bear', emoji: '🐻', label: 'Ayı', engine: 'earAccessory', params: { shape: 'round', outerColor: '#7a4a2b', innerColor: '#c98a5c', noseColor: '#1a1a1a', noseSize: 0.12 } },
    { id: 'mouse', emoji: '🐭', label: 'Fare', engine: 'earAccessory', params: { shape: 'round', earSize: 0.2, outerColor: '#a9a9ad', innerColor: '#ffc2d1', noseColor: '#ff8fab', noseSize: 0.08 } },
    { id: 'koala', emoji: '🐨', label: 'Koala', engine: 'earAccessory', params: { shape: 'round', earSize: 0.34, outerColor: '#9a9a9a', innerColor: '#5c5c5c', noseColor: '#1a1a1a', noseSize: 0.14 } },
    { id: 'pig', emoji: '🐷', label: 'Domuz', engine: 'earAccessory', params: { shape: 'round', earSize: 0.22, outerColor: '#ffb3c6', noseColor: '#ff8fab', noseSize: 0.16 } },
    { id: 'cow', emoji: '🐮', label: 'İnek', engine: 'earAccessory', params: { shape: 'floppy', outerColor: '#f5f0eb', innerColor: '#ffb3c6', noseColor: '#2b1a10', noseSize: 0.16 } },
    { id: 'wolf', emoji: '🐺', label: 'Kurt', engine: 'earAccessory', params: { shape: 'pointy', outerColor: '#5a5a5f', innerColor: '#c9c9cd', noseColor: '#1a1a1a', noseSize: 0.13 } },
    { id: 'fox', emoji: '🦊', label: 'Tilki', engine: 'earAccessory', params: { shape: 'pointy', outerColor: '#d9711a', innerColor: '#fff', noseColor: '#1a1a1a', noseSize: 0.12 }, plus: true },
    { id: 'tiger', emoji: '🐯', label: 'Kaplan', engine: 'earAccessory', params: { shape: 'pointy', outerColor: '#e8930f', innerColor: '#fff', noseColor: '#ff8fab', noseSize: 0.12 }, plus: true },
    { id: 'panda', emoji: '🐼', label: 'Panda', engine: 'earAccessory', params: { shape: 'round', outerColor: '#1a1a1a', innerColor: '#fff', noseColor: '#1a1a1a', noseSize: 0.13 }, plus: true },
    { id: 'lion', emoji: '🦁', label: 'Aslan', engine: 'earAccessory', params: { shape: 'round', earSize: 0.34, outerColor: '#c9761a', innerColor: '#ffdca0', noseColor: '#5a3a1a', noseSize: 0.14 }, plus: true },

    // Mouth / nose accents
    { id: 'mustache', emoji: '👨', label: 'Bıyık', engine: 'mouthAccessory', params: { type: 'mustache', color: '#2b1a10' } },
    { id: 'mustache-ginger', emoji: '🧑‍🦰', label: 'Kızıl Bıyık', engine: 'mouthAccessory', params: { type: 'mustache', color: '#c9591a' } },
    { id: 'mustache-gray', emoji: '🧓', label: 'Gri Bıyık', engine: 'mouthAccessory', params: { type: 'mustache', color: '#9a9aa2' } },
    { id: 'clownnose', emoji: '🔴', label: 'Palyaço Burnu', engine: 'mouthAccessory', params: { type: 'circle-nose', color: '#e8291c' } },
    { id: 'lips', emoji: '💋', label: 'Ruj', engine: 'mouthAccessory', params: { type: 'lips', color: '#e8296a' } },
    { id: 'vampire', emoji: '🧛', label: 'Vampir', engine: 'mouthAccessory', params: { type: 'fangs' }, plus: true },

    // Whole-frame color grades (no face required)
    { id: 'grayscale', emoji: '⚫', label: 'Siyah Beyaz', engine: 'colorGrade', params: { filter: CSS_FILTERS.grayscale }, needsFace: false },
    { id: 'sepia', emoji: '🟤', label: 'Sepya', engine: 'colorGrade', params: { filter: CSS_FILTERS.sepia }, needsFace: false },
    { id: 'invert', emoji: '🌀', label: 'Negatif', engine: 'colorGrade', params: { filter: CSS_FILTERS.invert }, needsFace: false },
    { id: 'warm', emoji: '🌅', label: 'Sıcak Ton', engine: 'colorGrade', params: { filter: CSS_FILTERS.warm }, needsFace: false },
    { id: 'cold', emoji: '🧊', label: 'Soğuk Ton', engine: 'colorGrade', params: { filter: CSS_FILTERS.cold }, needsFace: false },
    { id: 'vintage', emoji: '📽️', label: 'Vintage', engine: 'colorGrade', params: { filter: CSS_FILTERS.vintage }, needsFace: false },
    { id: 'highcontrast', emoji: '⚡', label: 'Yüksek Kontrast', engine: 'colorGrade', params: { filter: CSS_FILTERS.highcontrast }, needsFace: false },
    { id: 'moody', emoji: '🌑', label: 'Karamsar', engine: 'colorGrade', params: { filter: CSS_FILTERS.moody }, needsFace: false },
    { id: 'pastel', emoji: '🍬', label: 'Pastel', engine: 'colorGrade', params: { filter: CSS_FILTERS.pastel }, needsFace: false },
    { id: 'neon', emoji: '💜', label: 'Neon Mor', engine: 'colorGrade', params: { filter: CSS_FILTERS.neon }, needsFace: false, plus: true },
    { id: 'dreamy', emoji: '🌫️', label: 'Rüya Gibi', engine: 'colorGrade', params: { filter: CSS_FILTERS.dreamy }, needsFace: false, plus: true },
    { id: 'matrix', emoji: '🟢', label: 'Matrix', engine: 'colorGrade', params: { filter: CSS_FILTERS.matrix }, needsFace: false, plus: true },
    { id: 'cinematic', emoji: '🎬', label: 'Sinematik', engine: 'colorGrade', params: { filter: CSS_FILTERS.cinematic }, needsFace: false, plus: true },
  ];

  const byId = new Map(FILTERS.map((f) => [f.id, f]));

  function drawFilter(ctx, filterDef, lm) {
    if (filterDef.engine === 'custom') {
      const drawer = CUSTOM_DRAWERS[filterDef.id];
      if (drawer) drawer(ctx, lm);
      return;
    }
    if (!lm) return;
    switch (filterDef.engine) {
      case 'eyeAccessory': return engineEyeAccessory(ctx, lm, filterDef.params);
      case 'headAccessory': return engineHeadAccessory(ctx, lm, filterDef.params);
      case 'floatingEmoji': return engineFloatingEmoji(ctx, lm, filterDef.params);
      case 'earAccessory': return engineEarAccessory(ctx, lm, filterDef.params);
      case 'mouthAccessory': return engineMouthAccessory(ctx, lm, filterDef.params);
      default: return;
    }
  }

  /* ---------- Model loading + render loop ---------- */

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
    const def = byId.get(getFilterId());
    if (!def || def.needsFace === false || def.id === 'none' || videoEl.readyState < 2) return;
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
    const def = byId.get(getFilterId());

    ctx.save();
    if (getFacingMode() === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }

    if (def && def.engine === 'colorGrade') {
      ctx.filter = def.params.filter;
      ctx.drawImage(videoEl, 0, 0, w, h);
      ctx.filter = 'none';
    } else {
      ctx.drawImage(videoEl, 0, 0, w, h);
      if (def && def.id !== 'none') drawFilter(ctx, def, lastLandmarks);
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
