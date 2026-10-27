// Persistent settings + graphics presets + device detection.

export const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const PRESETS = {
  low: { label: 'Mobile performance', pixelRatio: 0.75, maxPixelRatio: 1, shadows: false, shadowSize: 512, drawDist: 110, loadRadius: 95, detailDist: 45, lights: 2, particles: 0.4, bloom: false, zombies: 22, texQ: 'low', rain: 400, env: false, antialias: false },
  medium: { label: 'Balanced', pixelRatio: 1, maxPixelRatio: 1.5, shadows: true, shadowSize: 1024, drawDist: 150, loadRadius: 120, detailDist: 60, lights: 4, particles: 0.7, bloom: false, zombies: 30, texQ: 'medium', rain: 900, env: true, antialias: false },
  high: { label: 'High', pixelRatio: 1, maxPixelRatio: 2, shadows: true, shadowSize: 2048, drawDist: 200, loadRadius: 150, detailDist: 80, lights: 6, particles: 1, bloom: true, zombies: 38, texQ: 'high', rain: 1600, env: true, antialias: true },
  ultra: { label: 'Ultra', pixelRatio: 1.25, maxPixelRatio: 2.5, shadows: true, shadowSize: 4096, drawDist: 260, loadRadius: 190, detailDist: 110, lights: 8, particles: 1, bloom: true, zombies: 46, texQ: 'high', rain: 2400, env: true, antialias: true },
};

export function detectPreset() {
  const mem = navigator.deviceMemory || 4;
  const small = Math.min(screen.width, screen.height) < 600;
  if (IS_IOS && small) return 'low';
  if (IS_TOUCH || IS_IOS) return mem >= 6 ? 'medium' : 'low';
  return mem >= 8 ? 'high' : 'medium';
}

const DEFAULTS = {
  preset: null, name: '', fov: 75, sens: 1.0, touchSens: 1.0, invertY: false, thirdPerson: false,
  master: 0.8, sfx: 1.0, ambient: 0.7, brightness: 1.0, showFps: false, adaptive: true,
  touchScale: 1.0, touchOpacity: 0.75, leftHanded: false, autoSprint: true, aimAssist: true,
  dayLength: 1440, server: '', renderScale: 1.0, headBob: true,
};

export class Settings {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('dd_settings') || '{}'); } catch (e) { saved = {}; }
    Object.assign(this, DEFAULTS, saved);
    if (!this.preset || !PRESETS[this.preset]) this.preset = detectPreset();
    this.listeners = [];
  }
  get gfx() { return PRESETS[this.preset]; }
  save() {
    const o = {};
    for (const k of Object.keys(DEFAULTS)) o[k] = this[k];
    try { localStorage.setItem('dd_settings', JSON.stringify(o)); } catch (e) { /* private mode */ }
    for (const l of this.listeners) l(this);
  }
  onChange(f) { this.listeners.push(f); }
}
