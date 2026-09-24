/* Snoop Bitmoji-style avatar: a pure SVG-string renderer plus the option catalog.
   UMD so the server can require() the same catalog to enforce Plus-only parts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnoopAvatar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /* ---------- Helpers ---------- */

  function shade(hex, amt) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((n >> 16) & 255) * (1 + amt));
    const g = clamp(((n >> 8) & 255) * (1 + amt));
    const b = clamp((n & 255) * (1 + amt));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  const GRADIENTS = {
    rainbow: ['#ff5a5a', '#ffb23f', '#ffe14d', '#3fd17a', '#4d9de0', '#8e5cff'],
    galaxy: ['#1b1446', '#4b2a8c', '#b04dff', '#2a1a5e'],
    gold: ['#fff1a8', '#f5c542', '#c9911a', '#f5c542'],
    sunset: ['#ff9a56', '#ff6b9d', '#a855f7'],
    ocean: ['#00c6ff', '#0072ff'],
    aurora: ['#00f5a0', '#00d9f5', '#8e5cff'],
    space: ['#0b0b2b', '#2a1a5e', '#0b0b2b'],
  };

  let uidCounter = 0;

  /* ---------- Catalog ---------- */

  const SKIN = [
    ['s1', '#FDE3D2'], ['s2', '#F7CBAA'], ['s3', '#EBB38E'], ['s4', '#D49872'],
    ['s5', '#B67B55'], ['s6', '#93603F'], ['s7', '#70452B'], ['s8', '#4D2E1C'],
  ].map(([id, color], i) => ({ id, label: `Ton ${i + 1}`, color }));

  const HAIR_COLORS = [
    { id: 'black', label: 'Siyah', color: '#1f1a17' },
    { id: 'darkbrown', label: 'Koyu Kahve', color: '#3b2417' },
    { id: 'brown', label: 'Kahve', color: '#6b4226' },
    { id: 'auburn', label: 'Kızıl', color: '#9a3f1e' },
    { id: 'blonde', label: 'Sarı', color: '#e3c16f' },
    { id: 'platinum', label: 'Platin', color: '#efe6cf' },
    { id: 'gray', label: 'Gri', color: '#9a9a9a' },
    { id: 'pink', label: 'Pembe', color: '#ff7eb6', plus: true },
    { id: 'blue', label: 'Mavi', color: '#4d9de0', plus: true },
    { id: 'purple', label: 'Mor', color: '#8e5cff', plus: true },
    { id: 'mint', label: 'Nane', color: '#2ecc9a', plus: true },
    { id: 'rainbow', label: 'Gökkuşağı', color: 'grad:rainbow', plus: true },
  ];

  const HAIR_STYLES = [
    { id: 'short', label: 'Kısa' }, { id: 'buzz', label: 'Çok Kısa' }, { id: 'sidepart', label: 'Yan Ayrık' },
    { id: 'spiky', label: 'Dikenli' }, { id: 'curly', label: 'Kıvırcık' }, { id: 'afro', label: 'Afro' },
    { id: 'long', label: 'Uzun' }, { id: 'wavy', label: 'Dalgalı' }, { id: 'bob', label: 'Küt' },
    { id: 'bun', label: 'Topuz' }, { id: 'ponytail', label: 'At Kuyruğu' }, { id: 'pigtails', label: 'İki Örgü' },
    { id: 'bald', label: 'Kel' },
    { id: 'mohawk', label: 'Mohikan', plus: true }, { id: 'spacebuns', label: 'Çift Topuz', plus: true },
  ];

  const EYES = [
    { id: 'normal', label: 'Normal' }, { id: 'happy', label: 'Mutlu' }, { id: 'wink', label: 'Göz Kırpma' },
    { id: 'sleepy', label: 'Uykulu' }, { id: 'surprised', label: 'Şaşkın' },
    { id: 'star', label: 'Yıldız', plus: true }, { id: 'heart', label: 'Kalp', plus: true },
  ];

  const MOUTHS = [
    { id: 'smile', label: 'Gülümseme' }, { id: 'grin', label: 'Sırıtma' }, { id: 'neutral', label: 'Düz' },
    { id: 'open', label: 'Açık' }, { id: 'tongue', label: 'Dil' }, { id: 'smirk', label: 'Yan Gülüş' },
  ];

  const FACIAL = [
    { id: 'none', label: 'Yok' }, { id: 'stubble', label: 'Kirli Sakal' }, { id: 'mustache', label: 'Bıyık' },
    { id: 'goatee', label: 'Keçi Sakal' }, { id: 'beard', label: 'Sakal' },
  ];

  const OUTFITS = [
    { id: 'tee-white', label: 'Beyaz Tişört', type: 'tee', main: '#f4f4f4' },
    { id: 'tee-black', label: 'Siyah Tişört', type: 'tee', main: '#2a2a2e' },
    { id: 'tee-red', label: 'Kırmızı Tişört', type: 'tee', main: '#e04848' },
    { id: 'tee-blue', label: 'Mavi Tişört', type: 'tee', main: '#3b7dd8' },
    { id: 'tee-green', label: 'Yeşil Tişört', type: 'tee', main: '#3aa35c' },
    { id: 'tee-yellow', label: 'Sarı Tişört', type: 'tee', main: '#f2c230' },
    { id: 'hoodie-gray', label: 'Gri Kapüşonlu', type: 'hoodie', main: '#8d8f96' },
    { id: 'hoodie-black', label: 'Siyah Kapüşonlu', type: 'hoodie', main: '#26262b' },
    { id: 'hoodie-navy', label: 'Lacivert Kapüşonlu', type: 'hoodie', main: '#23355e' },
    { id: 'hoodie-pink', label: 'Pembe Kapüşonlu', type: 'hoodie', main: '#f28bb3' },
    { id: 'sweater-cream', label: 'Krem Kazak', type: 'sweater', main: '#efe2c8' },
    { id: 'sweater-maroon', label: 'Bordo Kazak', type: 'sweater', main: '#7d2233' },
    { id: 'turtle-black', label: 'Siyah Balıkçı', type: 'turtleneck', main: '#1e1e22' },
    { id: 'turtle-camel', label: 'Deve Tüyü Balıkçı', type: 'turtleneck', main: '#c19a6b' },
    { id: 'tank-white', label: 'Beyaz Atlet', type: 'tank', main: '#f4f4f4' },
    { id: 'tank-black', label: 'Siyah Atlet', type: 'tank', main: '#2a2a2e' },
    { id: 'stripes-navy', label: 'Lacivert Çizgili', type: 'stripes', main: '#f4f4f4', second: '#23355e' },
    { id: 'stripes-red', label: 'Kırmızı Çizgili', type: 'stripes', main: '#f4f4f4', second: '#d33a3a' },
    { id: 'flannel-red', label: 'Kırmızı Oduncu', type: 'flannel', main: '#b3302f', second: '#1e1e22' },
    { id: 'flannel-green', label: 'Yeşil Oduncu', type: 'flannel', main: '#2f6b45', second: '#1e1e22' },
    { id: 'denim', label: 'Kot Gömlek', type: 'shirt', main: '#5b7fb0', second: '#f2d27a' },
    { id: 'polo-teal', label: 'Turkuaz Polo', type: 'polo', main: '#00a99a' },
    { id: 'jersey', label: 'Forma', type: 'jersey', main: '#e04848', second: '#ffffff' },
    { id: 'overalls', label: 'Salopet', type: 'overalls', main: '#f2c230', second: '#4a6fa5' },
    { id: 'dress-yellow', label: 'Sarı Elbise', type: 'dress', main: '#f5c842' },
    { id: 'dress-lilac', label: 'Lila Elbise', type: 'dress', main: '#b69cf0' },
    { id: 'suit-black', label: 'Siyah Takım', type: 'suit', main: '#1f1f24', second: '#c0392b', plus: true },
    { id: 'suit-navy', label: 'Lacivert Takım', type: 'suit', main: '#1f2d52', second: '#d4a017', plus: true },
    { id: 'tuxedo', label: 'Smokin', type: 'tux', main: '#141417', plus: true },
    { id: 'leather', label: 'Deri Ceket', type: 'leather', main: '#1a1a1d', plus: true },
    { id: 'bomber', label: 'Bomber Ceket', type: 'bomber', main: '#4a5a3a', second: '#e08a2e', plus: true },
    { id: 'varsity', label: 'Kolej Ceketi', type: 'varsity', main: '#b3202a', second: '#f4f1e8', plus: true },
    { id: 'gold', label: 'Altın Ceket', type: 'bomber', main: 'grad:gold', second: '#1e1e22', sparkle: true, plus: true },
    { id: 'royal', label: 'Kraliyet Pelerini', type: 'robe', main: '#5b2a86', plus: true },
    { id: 'kimono', label: 'Kimono', type: 'kimono', main: '#c0392b', second: '#f5c842', plus: true },
    { id: 'astronaut', label: 'Astronot', type: 'astronaut', main: '#eef0f3', plus: true },
    { id: 'hero', label: 'Süper Kahraman', type: 'hero', main: '#2656b8', second: '#d62b2b', plus: true },
    { id: 'puffer', label: 'Gümüş Mont', type: 'puffer', main: '#b9c0c9', plus: true },
    { id: 'galaxy', label: 'Galaksi Kapüşonlu', type: 'hoodie', main: 'grad:galaxy', sparkle: true, plus: true },
    { id: 'monogram', label: 'Tasarım Ceket', type: 'monogram', main: '#6b4a2b', second: '#d9b25f', plus: true },
  ];

  const ACCESSORIES = [
    { id: 'none', label: 'Yok' }, { id: 'glasses', label: 'Gözlük' }, { id: 'sunglasses', label: 'Güneş Gözlüğü' },
    { id: 'cap', label: 'Şapka' }, { id: 'beanie', label: 'Bere' }, { id: 'headphones', label: 'Kulaklık' },
    { id: 'bandana', label: 'Bandana' },
    { id: 'crown', label: 'Taç', plus: true }, { id: 'halo', label: 'Hale', plus: true },
    { id: 'chain', label: 'Altın Zincir', plus: true }, { id: 'earrings', label: 'Pırlanta Küpe', plus: true },
    { id: 'flowers', label: 'Çiçek Taç', plus: true }, { id: 'catears', label: 'Kedi Kulağı', plus: true },
    { id: 'starglasses', label: 'Yıldız Gözlük', plus: true },
  ];

  const BACKGROUNDS = [
    { id: 'teal', label: 'Turkuaz', color: '#00E5B8' }, { id: 'yellow', label: 'Sarı', color: '#FFD84D' },
    { id: 'pink', label: 'Pembe', color: '#FF9EC7' }, { id: 'blue', label: 'Mavi', color: '#7FB7FF' },
    { id: 'purple', label: 'Mor', color: '#B69CF0' }, { id: 'orange', label: 'Turuncu', color: '#FFAE5E' },
    { id: 'gray', label: 'Gri', color: '#C9CBD1' }, { id: 'mint', label: 'Nane', color: '#A8F0C6' },
    { id: 'sunset', label: 'Gün Batımı', color: 'grad:sunset', plus: true },
    { id: 'ocean', label: 'Okyanus', color: 'grad:ocean', plus: true },
    { id: 'aurora', label: 'Kutup Işığı', color: 'grad:aurora', plus: true },
    { id: 'space', label: 'Uzay', color: 'grad:space', stars: true, plus: true },
  ];

  const CATEGORIES = [
    { key: 'outfit', label: 'Kıyafet', options: OUTFITS },
    { key: 'hairStyle', label: 'Saç', options: HAIR_STYLES },
    { key: 'hairColor', label: 'Saç Rengi', options: HAIR_COLORS },
    { key: 'skin', label: 'Ten', options: SKIN },
    { key: 'eyes', label: 'Gözler', options: EYES },
    { key: 'mouth', label: 'Ağız', options: MOUTHS },
    { key: 'facial', label: 'Sakal', options: FACIAL },
    { key: 'accessory', label: 'Aksesuar', options: ACCESSORIES },
    { key: 'bg', label: 'Arka Plan', options: BACKGROUNDS },
  ];

  const DEFAULT = {
    skin: 's3', hairStyle: 'short', hairColor: 'darkbrown', eyes: 'normal', mouth: 'smile',
    facial: 'none', outfit: 'hoodie-gray', accessory: 'none', bg: 'teal',
  };

  function findOption(key, id) {
    const cat = CATEGORIES.find((c) => c.key === key);
    return cat ? cat.options.find((o) => o.id === id) : null;
  }

  function sanitize(input) {
    const config = {};
    const plusUsed = [];
    for (const cat of CATEGORIES) {
      const id = input && typeof input[cat.key] === 'string' ? input[cat.key] : DEFAULT[cat.key];
      const opt = cat.options.find((o) => o.id === id) || cat.options.find((o) => o.id === DEFAULT[cat.key]);
      config[cat.key] = opt.id;
      if (opt.plus) plusUsed.push(opt.label);
    }
    return { config, plusUsed };
  }

  function randomConfig(allowPlus) {
    const config = {};
    for (const cat of CATEGORIES) {
      const pool = cat.options.filter((o) => allowPlus || !o.plus);
      config[cat.key] = pool[Math.floor(Math.random() * pool.length)].id;
    }
    return config;
  }

  /* ---------- Drawing ---------- */

  const TORSO = 'M24,200 L26,178 Q30,156 62,149 L84,143 Q100,152 116,143 L138,149 Q170,156 174,178 L176,200 Z';

  function renderSvg(input) {
    const { config } = sanitize(input);
    const uid = 'sa' + (++uidCounter);
    const defs = [];
    const usedGrads = new Set();

    function paint(value) {
      if (typeof value === 'string' && value.startsWith('grad:')) {
        const name = value.slice(5);
        if (!usedGrads.has(name)) {
          usedGrads.add(name);
          const stops = GRADIENTS[name]
            .map((c, i, arr) => `<stop offset="${(i / (arr.length - 1)) * 100}%" stop-color="${c}"/>`)
            .join('');
          defs.push(`<linearGradient id="${uid}-${name}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`);
        }
        return `url(#${uid}-${name})`;
      }
      return value;
    }
    function base(value) {
      return typeof value === 'string' && value.startsWith('grad:') ? GRADIENTS[value.slice(5)][1] : value;
    }

    const skin = findOption('skin', config.skin).color;
    const skinDark = shade(skin, -0.18);
    const hairOpt = findOption('hairColor', config.hairColor);
    const hair = paint(hairOpt.color);
    const hairBase = base(hairOpt.color);
    const outfit = findOption('outfit', config.outfit);
    const bgOpt = findOption('bg', config.bg);

    defs.push(`<clipPath id="${uid}-c"><circle cx="100" cy="100" r="100"/></clipPath>`);
    defs.push(`<clipPath id="${uid}-t"><path d="${TORSO}"/></clipPath>`);

    const layers = [];
    layers.push(`<rect width="200" height="200" fill="${paint(bgOpt.color)}"/>`);
    if (bgOpt.stars) {
      for (const [x, y, r] of [[30, 40, 1.6], [160, 30, 2], [50, 120, 1.2], [170, 110, 1.5], [20, 90, 1], [140, 60, 1.1], [90, 20, 1.3]]) {
        layers.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.9"/>`);
      }
    }

    layers.push(hairBack(config.hairStyle, hair));
    const outfitParts = drawOutfit(outfit, skin, paint, base, uid);
    layers.push(outfitParts.back);

    // ears + neck
    layers.push(`<circle cx="61" cy="92" r="9" fill="${skin}"/><circle cx="139" cy="92" r="9" fill="${skin}"/>`);
    layers.push(`<circle cx="61" cy="92" r="4" fill="${skinDark}" opacity="0.5"/><circle cx="139" cy="92" r="4" fill="${skinDark}" opacity="0.5"/>`);
    layers.push(`<path d="M86,112 L114,112 L116,150 Q100,160 84,150 Z" fill="${skin}"/>`);
    layers.push(`<path d="M86,128 Q100,138 114,128 L114,134 Q100,142 86,134 Z" fill="${skinDark}" opacity="0.35"/>`);

    layers.push(outfitParts.body);
    if (config.accessory === 'chain') layers.push(accessoryNeck());

    // head
    layers.push(`<ellipse cx="100" cy="88" rx="40" ry="46" fill="${skin}"/>`);
    layers.push(facialHair(config.facial, hair));
    layers.push(face(config, skin, skinDark, hairBase));
    layers.push(mouth(config.mouth));
    if (config.facial === 'mustache' || config.facial === 'goatee' || config.facial === 'beard') {
      layers.push(`<path d="M85,111 Q93,104 100,109 Q107,104 115,111 Q107,113 100,112 Q93,113 85,111 Z" fill="${hair}"/>`);
    }
    layers.push(hairFront(config.hairStyle, hair));
    layers.push(accessoryHead(config.accessory));

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%"><defs>${defs.join('')}</defs><g clip-path="url(#${uid}-c)">${layers.join('')}</g></svg>`;
  }

  /* ---------- Hair ---------- */

  function curlRow(color, cx, cy, rx, ry, from, to, count, r) {
    let s = '';
    for (let i = 0; i < count; i++) {
      const a = ((from + ((to - from) * i) / (count - 1)) * Math.PI) / 180;
      s += `<circle cx="${(cx + rx * Math.cos(a)).toFixed(1)}" cy="${(cy + ry * Math.sin(a)).toFixed(1)}" r="${r}" fill="${color}"/>`;
    }
    return s;
  }

  const FRONT = {
    short: 'M58,92 C54,50 76,36 100,36 C124,36 146,50 142,92 C138,76 130,66 118,62 C108,70 90,70 80,62 C70,66 62,76 58,92 Z',
    buzz: 'M61,80 C62,52 80,42 100,42 C120,42 138,52 139,80 C128,64 116,58 100,58 C84,58 72,64 61,80 Z',
    sidepart: 'M58,94 C52,50 78,34 104,36 C128,38 148,54 142,92 C140,74 132,62 120,58 C104,66 80,64 66,70 C62,76 59,84 58,94 Z',
    spiky: 'M58,90 L56,60 L66,66 L68,44 L80,54 L86,34 L96,50 L104,32 L112,50 L122,36 L126,56 L138,46 L136,64 L146,62 L142,90 C136,72 124,64 100,64 C76,64 64,72 58,90 Z',
    bangs: 'M58,88 C54,48 78,36 100,36 C122,36 146,48 142,88 C142,80 140,74 136,72 L64,72 C60,74 58,80 58,88 Z',
  };

  function hairBack(style, hair) {
    switch (style) {
      case 'afro': return `<circle cx="100" cy="80" r="62" fill="${hair}"/>`;
      case 'long': return `<path d="M56,90 C50,44 76,32 100,32 C124,32 150,44 144,90 L152,168 C130,176 70,176 48,168 Z" fill="${hair}"/>`;
      case 'wavy': return `<path d="M56,90 C50,44 76,32 100,32 C124,32 150,44 144,90 L150,150 Q156,162 146,170 Q136,178 124,170 Q112,178 100,170 Q88,178 76,170 Q64,178 54,170 Q44,162 50,150 Z" fill="${hair}"/>`;
      case 'bob': return `<path d="M54,88 C50,42 76,34 100,34 C124,34 150,42 146,88 L148,128 Q146,136 134,134 L66,134 Q54,136 52,128 Z" fill="${hair}"/>`;
      case 'ponytail': return `<path d="M128,58 C162,60 170,100 158,142 C154,152 146,148 148,138 C154,110 150,82 126,74 Z" fill="${hair}"/>`;
      case 'pigtails': return `<path d="M64,86 C40,94 34,132 44,152 C48,158 56,154 53,146 C48,124 52,104 68,98 Z" fill="${hair}"/><path d="M136,86 C160,94 166,132 156,152 C152,158 144,154 147,146 C152,124 148,104 132,98 Z" fill="${hair}"/>`;
      default: return '';
    }
  }

  function hairFront(style, hair) {
    switch (style) {
      case 'short': return `<path d="${FRONT.short}" fill="${hair}"/>`;
      case 'buzz': return `<path d="${FRONT.buzz}" fill="${hair}" opacity="0.92"/>`;
      case 'sidepart':
      case 'ponytail':
      case 'wavy': return `<path d="${FRONT.sidepart}" fill="${hair}"/>`;
      case 'spiky': return `<path d="${FRONT.spiky}" fill="${hair}"/>`;
      case 'curly': return `<path d="${FRONT.buzz}" fill="${hair}"/>` + curlRow(hair, 100, 82, 42, 42, 190, 350, 11, 11);
      case 'afro': return curlRow(hair, 100, 82, 40, 38, 200, 340, 9, 9);
      case 'long':
      case 'bob':
      case 'pigtails': return `<path d="${FRONT.bangs}" fill="${hair}"/>`;
      case 'bun': return `<circle cx="100" cy="34" r="16" fill="${hair}"/><path d="${FRONT.short}" fill="${hair}"/>`;
      case 'spacebuns': return `<circle cx="68" cy="42" r="15" fill="${hair}"/><circle cx="132" cy="42" r="15" fill="${hair}"/><path d="${FRONT.short}" fill="${hair}"/>`;
      case 'mohawk': return `<path d="${FRONT.buzz}" fill="${hair}" opacity="0.45"/><path d="M89,70 C86,40 92,16 100,12 C108,16 114,40 111,70 Z" fill="${hair}"/>`;
      case 'bald': return `<ellipse cx="88" cy="56" rx="10" ry="5" fill="#fff" opacity="0.25"/>`;
      default: return '';
    }
  }

  function facialHair(style, hair) {
    if (style === 'stubble') {
      return `<path d="M66,104 C68,130 86,140 100,140 C114,140 132,130 134,104 C126,122 114,128 100,128 C86,128 74,122 66,104 Z" fill="${hair}" opacity="0.28"/>`;
    }
    if (style === 'goatee') return `<path d="M91,122 Q100,119 109,122 L107,134 Q100,139 93,134 Z" fill="${hair}"/>`;
    if (style === 'beard') {
      return `<path d="M62,96 C62,126 80,144 100,144 C120,144 138,126 138,96 C134,112 126,124 116,122 Q100,118 84,122 C74,124 66,112 62,96 Z" fill="${hair}"/>`;
    }
    return '';
  }

  /* ---------- Face ---------- */

  function star(cx, cy, r, fill) {
    let pts = '';
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts += `${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)} `;
    }
    return `<polygon points="${pts.trim()}" fill="${fill}"/>`;
  }

  function heart(cx, cy, s, fill) {
    return `<path d="M${cx},${cy + s * 0.9} C${cx - s * 1.4},${cy} ${cx - s * 0.8},${cy - s} ${cx},${cy - s * 0.3} C${cx + s * 0.8},${cy - s} ${cx + s * 1.4},${cy} ${cx},${cy + s * 0.9} Z" fill="${fill}"/>`;
  }

  function eye(x, kind) {
    const y = 88;
    switch (kind) {
      case 'closed': return `<path d="M${x - 7},${y + 1} Q${x},${y - 6} ${x + 7},${y + 1}" stroke="#2b1d14" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 'sleepy': return `<path d="M${x - 7},${y} Q${x},${y + 5} ${x + 7},${y}" stroke="#2b1d14" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 'surprised': return `<ellipse cx="${x}" cy="${y}" rx="8" ry="9" fill="#fff"/><circle cx="${x}" cy="${y}" r="3.4" fill="#2b1d14"/>`;
      case 'star': return star(x, y, 9, '#f5c542');
      case 'heart': return heart(x, y, 8, '#ff3b6b');
      default: return `<ellipse cx="${x}" cy="${y}" rx="7" ry="6.5" fill="#fff"/><circle cx="${x}" cy="${y + 0.5}" r="4" fill="#2b1d14"/><circle cx="${x + 1.4}" cy="${y - 1.2}" r="1.3" fill="#fff"/>`;
    }
  }

  function face(config, skin, skinDark, hairBase) {
    let s = '';
    const brow = shade(hairBase, -0.15);
    s += `<path d="M75,76 Q84,70 93,75" stroke="${brow}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M107,75 Q116,70 125,76" stroke="${brow}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    const e = config.eyes;
    if (e === 'happy') s += eye(84, 'closed') + eye(116, 'closed');
    else if (e === 'wink') s += eye(84, 'normal') + eye(116, 'closed');
    else s += eye(84, e) + eye(116, e);
    s += `<path d="M100,96 Q96,104 99,106 Q102,107 105,104" stroke="${skinDark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    s += `<circle cx="77" cy="104" r="6" fill="#ff8a8a" opacity="0.22"/><circle cx="123" cy="104" r="6" fill="#ff8a8a" opacity="0.22"/>`;
    return s;
  }

  function mouth(kind) {
    const lip = '#7a2e2a';
    switch (kind) {
      case 'grin': return `<path d="M86,114 Q100,131 114,114 Z" fill="${lip}"/><path d="M88,115 Q100,119 112,115 L111,118 Q100,121 89,118 Z" fill="#fff"/>`;
      case 'neutral': return `<path d="M90,118 L110,118" stroke="${lip}" stroke-width="3" stroke-linecap="round"/>`;
      case 'open': return `<ellipse cx="100" cy="119" rx="6" ry="7" fill="${lip}"/><ellipse cx="100" cy="123" rx="4" ry="2.5" fill="#ff8fa3"/>`;
      case 'tongue': return `<path d="M86,114 Q100,131 114,114 Z" fill="${lip}"/><ellipse cx="102" cy="125" rx="6" ry="5" fill="#ff7a93"/>`;
      case 'smirk': return `<path d="M90,119 Q104,121 112,112" stroke="${lip}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      default: return `<path d="M88,114 Q100,126 112,114" stroke="${lip}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    }
  }

  /* ---------- Outfits ---------- */

  function drawOutfit(o, skin, paint, base, uid) {
    const main = paint(o.main);
    const mainBase = base(o.main);
    const dark = shade(mainBase, -0.22);
    const second = o.second ? paint(o.second) : dark;
    const body = (fill) => `<path d="${TORSO}" fill="${fill}"/>`;
    const seams = `<path d="M62,150 Q58,176 60,200 M138,150 Q142,176 140,200" stroke="${dark}" stroke-width="2" fill="none" opacity="0.5"/>`;
    const clipped = (inner) => `<g clip-path="url(#${uid}-t)">${inner}</g>`;
    const collar = `<path d="M84,143 L92,160 L100,150 Z" fill="${shade(mainBase, 0.12)}"/><path d="M116,143 L108,160 L100,150 Z" fill="${shade(mainBase, 0.12)}"/>`;
    const sparkle = o.sparkle
      ? [[60, 172], [132, 180], [100, 190], [150, 165], [78, 190]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="#fff" opacity="0.9"/>`).join('')
      : '';
    let back = '';
    let s = '';

    switch (o.type) {
      case 'tee':
        s = body(main) + seams + `<path d="M84,143 Q100,154 116,143" stroke="${dark}" stroke-width="3" fill="none"/>`;
        break;
      case 'hoodie':
        back = `<path d="M60,154 C54,118 74,106 100,106 C126,106 146,118 140,154 Z" fill="${dark}"/>`;
        s = body(main) + seams
          + `<path d="M76,146 Q100,172 124,146" stroke="${dark}" stroke-width="7" fill="none"/>`
          + `<path d="M92,156 L90,176 M108,156 L110,176" stroke="#f4f4f4" stroke-width="2" stroke-linecap="round"/>`
          + `<path d="M70,186 L130,186 L126,200 L74,200 Z" fill="${dark}" opacity="0.6"/>` + sparkle;
        break;
      case 'sweater':
        s = body(main) + seams
          + clipped([0, 1, 2, 3].map((i) => `<path d="M20,${168 + i * 9} L180,${168 + i * 9}" stroke="${dark}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.5"/>`).join(''))
          + `<path d="M83,143 Q100,158 117,143" stroke="${dark}" stroke-width="6" fill="none"/>`;
        break;
      case 'turtleneck':
        s = body(main) + seams + `<path d="M85,122 L115,122 L117,150 Q100,158 83,150 Z" fill="${main}"/>`
          + `<path d="M86,130 L114,130 M86,137 L114,137 M85,144 L115,144" stroke="${dark}" stroke-width="1.5" opacity="0.6"/>`;
        break;
      case 'tank':
        s = body(skin) + `<path d="M58,200 L60,170 Q64,154 76,150 L84,150 Q100,172 116,150 L124,150 Q136,154 140,170 L142,200 Z" fill="${main}"/>`;
        break;
      case 'stripes':
        s = body(main) + clipped([0, 1, 2, 3, 4, 5].map((i) => `<rect x="0" y="${152 + i * 10}" width="200" height="5" fill="${second}"/>`).join(''))
          + `<path d="M84,143 Q100,154 116,143" stroke="${second}" stroke-width="3" fill="none"/>`;
        break;
      case 'flannel':
        s = body(main) + clipped(
          [40, 70, 100, 130, 160].map((x) => `<rect x="${x}" y="140" width="7" height="70" fill="${second}" opacity="0.35"/>`).join('')
          + [158, 178, 198].map((y) => `<rect x="0" y="${y}" width="200" height="7" fill="${second}" opacity="0.35"/>`).join('')
        ) + collar + `<path d="M100,152 L100,200" stroke="${dark}" stroke-width="2"/>`
          + [165, 180, 195].map((y) => `<circle cx="100" cy="${y}" r="2" fill="#eee"/>`).join('');
        break;
      case 'shirt':
        s = body(main) + seams + collar + `<path d="M100,152 L100,200" stroke="${second}" stroke-width="1.5" stroke-dasharray="3 3"/>`
          + [165, 180, 195].map((y) => `<circle cx="104" cy="${y}" r="2" fill="${second}"/>`).join('')
          + `<path d="M70,165 L88,165 L88,178 L70,178 Z" fill="none" stroke="${second}" stroke-width="1.5" stroke-dasharray="3 2"/>`;
        break;
      case 'polo':
        s = body(main) + seams + collar + `<path d="M100,150 L100,170" stroke="${dark}" stroke-width="2"/><circle cx="100" cy="158" r="1.8" fill="#fff"/><circle cx="100" cy="166" r="1.8" fill="#fff"/>`;
        break;
      case 'jersey':
        s = body(main) + `<path d="M86,144 L100,164 L114,144 Q100,150 86,144 Z" fill="${skin}"/><path d="M85,143 L100,165 L115,143" stroke="${second}" stroke-width="4" fill="none"/>`
          + `<path d="M30,172 L50,166 M170,172 L150,166" stroke="${second}" stroke-width="5"/>`
          + `<text x="100" y="192" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="22" text-anchor="middle" fill="${second}">10</text>`;
        break;
      case 'overalls':
        s = body(main) + `<path d="M84,143 Q100,154 116,143" stroke="${dark}" stroke-width="3" fill="none"/>`
          + `<path d="M70,168 L130,168 L134,200 L66,200 Z" fill="${second}"/><path d="M72,168 L66,148 M128,168 L134,148" stroke="${second}" stroke-width="7"/>`
          + `<circle cx="74" cy="172" r="2.5" fill="#f2c230"/><circle cx="126" cy="172" r="2.5" fill="#f2c230"/><rect x="88" y="176" width="24" height="14" rx="2" fill="${shade(base(o.second), -0.15)}"/>`;
        break;
      case 'dress':
        s = body(skin) + `<path d="M62,200 L66,168 Q72,160 80,161 L120,161 Q128,160 134,168 L138,200 Z" fill="${main}"/>`
          + `<path d="M80,162 L86,146 M120,162 L114,146" stroke="${main}" stroke-width="3"/><path d="M80,161 Q100,170 120,161" stroke="${dark}" stroke-width="2" fill="none"/>`;
        break;
      case 'suit':
      case 'tux': {
        s = body(main) + `<path d="M84,144 L100,196 L116,144 Q100,152 84,144 Z" fill="#fafafa"/>`;
        const lapel = o.type === 'tux' ? '#2a2a30' : shade(mainBase, 0.15);
        s += `<path d="M84,143 L72,160 L84,164 L100,196 Z" fill="${lapel}"/><path d="M116,143 L128,160 L116,164 L100,196 Z" fill="${lapel}"/>`;
        if (o.type === 'tux') s += `<path d="M88,152 L100,157 L112,152 L112,164 L100,159 L88,164 Z" fill="#111"/><circle cx="100" cy="158" r="2.6" fill="#111"/>`;
        else s += `<path d="M96,151 L104,151 L103,157 L106,184 L100,191 L94,184 L97,157 Z" fill="${second}"/>`;
        s += `<rect x="126" y="170" width="12" height="3" fill="#fafafa" opacity="0.9"/>`;
        break;
      }
      case 'leather':
        s = body(main) + `<path d="M86,144 L100,164 L114,144 Q100,152 86,144 Z" fill="#f4f4f4"/>`
          + `<path d="M84,143 L68,164 L82,168 L96,150 Z" fill="#2c2c31"/><path d="M116,143 L134,162 L120,170 L104,150 Z" fill="#2c2c31"/>`
          + `<path d="M104,152 L112,200" stroke="#c9c9cf" stroke-width="2"/><path d="M44,176 Q50,164 58,160" stroke="#fff" stroke-width="3" opacity="0.18" fill="none"/>`;
        break;
      case 'bomber':
        s = body(main) + seams + `<path d="M80,144 Q100,160 120,144 L122,152 Q100,168 78,152 Z" fill="${second}"/>`
          + `<path d="M100,160 L100,200" stroke="${shade(base(o.second), 0.3)}" stroke-width="2.5"/>`
          + `<rect x="66" y="172" width="16" height="3" rx="1.5" fill="${second}"/>` + sparkle;
        break;
      case 'varsity':
        s = body(main)
          + `<path d="M24,200 L26,178 Q30,156 62,149 L68,172 L62,200 Z" fill="${second}"/><path d="M176,200 L174,178 Q170,156 138,149 L132,172 L138,200 Z" fill="${second}"/>`
          + `<path d="M80,144 Q100,160 120,144" stroke="${second}" stroke-width="6" fill="none"/>`
          + `<text x="82" y="184" font-family="Georgia, serif" font-weight="700" font-size="24" text-anchor="middle" fill="${second}">S</text>`
          + [164, 176, 188].map((y) => `<circle cx="112" cy="${y}" r="2.2" fill="${second}"/>`).join('');
        break;
      case 'robe':
        s = body(main) + `<path d="M84,143 L100,200 M116,143 L100,200" stroke="#f7f3ea" stroke-width="10"/>`
          + [[90, 162], [96, 182], [110, 162], [104, 182], [86, 150], [114, 150]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#222"/>`).join('')
          + `<path d="M40,158 Q100,136 160,158" stroke="#f7f3ea" stroke-width="8" fill="none"/><circle cx="100" cy="160" r="5" fill="#f5c542"/>`;
        break;
      case 'kimono':
        s = body(main) + `<path d="M86,144 L100,166 L114,144 Q100,150 86,144 Z" fill="${skin}"/>`
          + `<path d="M84,143 L118,200 M116,143 L100,170" stroke="${second}" stroke-width="5"/>`
          + `<rect x="24" y="184" width="152" height="12" fill="${second}"/>`
          + clipped([[50, 165], [150, 170], [70, 195], [140, 150]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#fff" opacity="0.25"/>`).join(''));
        break;
      case 'astronaut':
        s = body(main) + seams + `<path d="M78,146 Q100,166 122,146" stroke="#9aa3ad" stroke-width="9" fill="none"/>`
          + `<circle cx="72" cy="176" r="8" fill="#2656b8"/><path d="M66,176 L78,176" stroke="#fff" stroke-width="2"/>`
          + `<rect x="112" y="170" width="20" height="14" rx="2" fill="#cfd4da"/><circle cx="117" cy="177" r="2" fill="#e04848"/><circle cx="124" cy="177" r="2" fill="#3aa35c"/>`;
        break;
      case 'hero':
        back = `<path d="M36,162 Q100,122 164,162 L190,200 L10,200 Z" fill="${second}"/>`;
        s = body(main) + seams + `<path d="M84,143 Q100,154 116,143" stroke="${shade(mainBase, -0.3)}" stroke-width="3" fill="none"/>`
          + `<path d="M100,160 L116,172 L100,194 L84,172 Z" fill="#f5c542"/>` + star(100, 176, 8, second)
          + `<rect x="24" y="196" width="152" height="4" fill="#f5c542"/>`;
        break;
      case 'puffer':
        s = body(main) + clipped([158, 170, 182, 194].map((y) => `<path d="M20,${y} Q100,${y + 6} 180,${y}" stroke="${dark}" stroke-width="2" fill="none"/>`).join(''))
          + `<path d="M80,140 L120,140 L122,152 Q100,162 78,152 Z" fill="${dark}"/><path d="M100,152 L100,200" stroke="${shade(mainBase, 0.25)}" stroke-width="2"/>`
          + `<path d="M46,172 Q52,162 60,158" stroke="#fff" stroke-width="3" opacity="0.3" fill="none"/>`;
        break;
      case 'monogram': {
        let pattern = '';
        for (let y = 152; y < 205; y += 14) {
          for (let x = 24 + ((y / 14) % 2) * 7; x < 180; x += 14) {
            pattern += `<text x="${x}" y="${y}" font-family="Georgia, serif" font-size="9" fill="${second}" opacity="0.7">S</text>`;
          }
        }
        s = body(main) + clipped(pattern) + `<path d="M86,144 L100,164 L114,144 Q100,152 86,144 Z" fill="#1e1e22"/>`
          + `<path d="M84,143 L100,168 L116,143" stroke="${second}" stroke-width="3" fill="none"/>`;
        break;
      }
      default:
        s = body(main);
    }
    return { back, body: s };
  }

  /* ---------- Accessories ---------- */

  function accessoryNeck() {
    return `<path d="M84,146 Q100,170 116,146" stroke="#f5c542" stroke-width="3.5" fill="none" stroke-dasharray="4 2"/><circle cx="100" cy="164" r="5" fill="#f5c542"/><circle cx="100" cy="164" r="2" fill="#fff" opacity="0.7"/>`;
  }

  function accessoryHead(kind) {
    switch (kind) {
      case 'glasses':
        return `<circle cx="84" cy="88" r="11" fill="#fff" fill-opacity="0.12" stroke="#222" stroke-width="3"/><circle cx="116" cy="88" r="11" fill="#fff" fill-opacity="0.12" stroke="#222" stroke-width="3"/><path d="M95,87 Q100,83 105,87 M73,86 L62,84 M127,86 L138,84" stroke="#222" stroke-width="3" fill="none"/>`;
      case 'sunglasses':
        return `<rect x="71" y="80" width="26" height="17" rx="7" fill="#111"/><rect x="103" y="80" width="26" height="17" rx="7" fill="#111"/><path d="M97,86 Q100,83 103,86 M71,85 L62,83 M129,85 L138,83" stroke="#111" stroke-width="3" fill="none"/><path d="M76,84 L82,84 M108,84 L114,84" stroke="#fff" stroke-width="2" opacity="0.5"/>`;
      case 'starglasses':
        return star(84, 88, 15, '#ff5fa2') + star(116, 88, 15, '#ff5fa2') + `<circle cx="84" cy="89" r="6" fill="#222" opacity="0.8"/><circle cx="116" cy="89" r="6" fill="#222" opacity="0.8"/><path d="M97,86 Q100,83 103,86" stroke="#ff5fa2" stroke-width="3" fill="none"/>`;
      case 'cap':
        return `<path d="M58,74 C58,38 80,30 100,30 C120,30 142,38 142,74 Z" fill="#00a99a"/><path d="M56,72 Q100,60 152,72 Q160,80 150,84 Q100,74 56,80 Z" fill="#007f74"/><circle cx="100" cy="31" r="4" fill="#007f74"/>`;
      case 'beanie':
        return `<path d="M56,80 C54,36 78,26 100,26 C122,26 146,36 144,80 Z" fill="#d33a3a"/><path d="M54,68 Q100,58 146,68 L146,84 Q100,74 54,84 Z" fill="#a82a2a"/><circle cx="100" cy="24" r="9" fill="#f4f4f4"/>`;
      case 'headphones':
        return `<path d="M58,92 C54,30 146,30 142,92" stroke="#2a2a2e" stroke-width="8" fill="none"/><rect x="46" y="80" width="16" height="28" rx="7" fill="#2a2a2e"/><rect x="138" y="80" width="16" height="28" rx="7" fill="#2a2a2e"/><rect x="49" y="86" width="10" height="16" rx="4" fill="#e04848"/><rect x="141" y="86" width="10" height="16" rx="4" fill="#e04848"/>`;
      case 'bandana':
        return `<path d="M58,70 Q100,56 142,70 L142,82 Q100,68 58,82 Z" fill="#d33a3a"/><path d="M140,72 L156,64 L152,78 Z M140,78 L154,86 L146,90 Z" fill="#d33a3a"/><circle cx="80" cy="72" r="1.5" fill="#fff"/><circle cx="100" cy="68" r="1.5" fill="#fff"/><circle cx="120" cy="72" r="1.5" fill="#fff"/>`;
      case 'crown':
        return `<path d="M68,48 L72,18 L86,34 L100,12 L114,34 L128,18 L132,48 Z" fill="#f5c542" stroke="#c9911a" stroke-width="2"/><circle cx="86" cy="42" r="3.5" fill="#e04848"/><circle cx="100" cy="40" r="4" fill="#3b7dd8"/><circle cx="114" cy="42" r="3.5" fill="#3aa35c"/>`;
      case 'halo':
        return `<ellipse cx="100" cy="22" rx="30" ry="8" fill="none" stroke="#f5c542" stroke-width="5"/><ellipse cx="100" cy="22" rx="30" ry="8" fill="none" stroke="#fff6c7" stroke-width="1.5"/>`;
      case 'earrings':
        return `<path d="M61,100 L65,105 L61,111 L57,105 Z" fill="#bfe9ff" stroke="#fff" stroke-width="1"/><path d="M139,100 L143,105 L139,111 L135,105 Z" fill="#bfe9ff" stroke="#fff" stroke-width="1"/>`;
      case 'flowers': {
        let s = '';
        const colors = ['#ff7eb6', '#ffd84d', '#fff', '#ff9e5e', '#b69cf0'];
        for (let i = 0; i < 7; i++) {
          const a = ((200 + (140 * i) / 6) * Math.PI) / 180;
          const x = 100 + 44 * Math.cos(a);
          const y = 78 + 42 * Math.sin(a);
          const c = colors[i % colors.length];
          for (let p = 0; p < 5; p++) {
            const pa = (p * 72 * Math.PI) / 180;
            s += `<circle cx="${(x + 5 * Math.cos(pa)).toFixed(1)}" cy="${(y + 5 * Math.sin(pa)).toFixed(1)}" r="4.2" fill="${c}"/>`;
          }
          s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#f5c542"/>`;
        }
        return s;
      }
      case 'catears':
        return `<path d="M60,70 C66,40 134,40 140,70" stroke="#2a2a2e" stroke-width="5" fill="none"/><path d="M64,58 L68,30 L86,46 Z" fill="#2a2a2e"/><path d="M136,58 L132,30 L114,46 Z" fill="#2a2a2e"/><path d="M69,50 L71,38 L79,46 Z" fill="#ff9ec7"/><path d="M131,50 L129,38 L121,46 Z" fill="#ff9ec7"/>`;
      default:
        return '';
    }
  }

  return { CATEGORIES, DEFAULT, sanitize, randomConfig, findOption, render: renderSvg };
});
