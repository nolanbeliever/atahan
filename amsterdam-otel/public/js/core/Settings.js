// Kullanıcı ayarları (localStorage) ve grafik kalite ön ayarları.

const KEY = 'amsterdam-otel:settings:v1';

/**
 * pixelRatioCap: render ölçeği üst sınırı (mobil/tablette her zaman 1.0'a kısılır)
 * shadowSize:    gölge haritası çözünürlüğü (0 = gölge yok)
 * texSize:       prosedürel doku çözünürlüğü (px)
 */
export const QUALITY_PRESETS = Object.freeze({
  low: { name: 'low', label: 'Düşük', pixelRatioCap: 1.0, shadowSize: 0, texSize: 128, anisotropy: 1, antialias: false },
  medium: { name: 'medium', label: 'Orta', pixelRatioCap: 1.0, shadowSize: 512, texSize: 256, anisotropy: 2, antialias: false },
  high: { name: 'high', label: 'Yüksek', pixelRatioCap: 1.5, shadowSize: 1024, texSize: 512, anisotropy: 4, antialias: true },
});

export function defaultSettings(device) {
  return {
    // Mobil/tablette pil için varsayılan 30 FPS, masaüstünde 60 FPS
    fps: device.touch ? 30 : 60,
    quality: 'auto',
    showFps: false,
    name: '',
    // Trip efektlerinde sallanma/dalgalanmayı kapat (hareket hassasiyeti; ayrıca pil dostu)
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    sound: true,
  };
}

export function loadSettings(device) {
  const base = defaultSettings(device);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      fps: s.fps === 30 || s.fps === 60 ? s.fps : base.fps,
      quality: ['auto', 'low', 'medium', 'high'].includes(s.quality) ? s.quality : base.quality,
      showFps: !!s.showFps,
      name: typeof s.name === 'string' ? s.name.slice(0, 16) : '',
      reduceMotion: typeof s.reduceMotion === 'boolean' ? s.reduceMotion : base.reduceMotion,
      sound: typeof s.sound === 'boolean' ? s.sound : base.sound,
    };
  } catch {
    return base;
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* gizli sekme vb. — ayarlar bu oturumla sınırlı kalır */
  }
}

export function resolveQuality(choice, device) {
  let name = choice;
  if (name === 'auto') {
    if (device.phone) name = 'low';
    else if (device.tablet) name = device.lowEnd ? 'low' : 'medium';
    else name = device.lowEnd ? 'medium' : 'high';
  }
  const preset = { ...QUALITY_PRESETS[name] };
  // Mobil/tablette render ölçeği kesinlikle 1.0 ile sınırlı
  if (device.touch) preset.pixelRatioCap = Math.min(preset.pixelRatioCap, 1.0);
  return preset;
}
