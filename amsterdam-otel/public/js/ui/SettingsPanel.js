import { saveSettings, resolveQuality } from '../core/Settings.js';

/** Ayarlar penceresi: FPS sınırı (30/60), grafik kalitesi, FPS göstergesi */
export class SettingsPanel {
  constructor({ settings, device, engine, onOpenChange, onShowFps }) {
    this.settings = settings;
    this.device = device;
    this.engine = engine;
    this.onOpenChange = onOpenChange;
    this.onShowFps = onShowFps;
    this.root = document.getElementById('settings');
    this.fpsSeg = document.getElementById('set-fps');
    this.quality = document.getElementById('set-quality');
    this.showFps = document.getElementById('set-showfps');
    this.reduceMotion = document.getElementById('set-reducemotion');
    this.sound = document.getElementById('set-sound');
    this.note = document.getElementById('set-note');
    this.initialQuality = settings.quality;

    document.getElementById('btn-settings').addEventListener('click', () => this.open());
    // Masaüstünde fare kilitliyken HUD butonuna tıklanamaz → duraklatma ekranında da var
    document.getElementById('btn-overlay-settings').addEventListener('click', () => this.open());
    document.getElementById('btn-settings-close').addEventListener('click', () => this.close());

    this.fpsSeg.addEventListener('click', (e) => {
      const v = Number(e.target?.dataset?.value);
      if (v !== 30 && v !== 60) return;
      settings.fps = v;
      saveSettings(settings);
      engine.setFpsCap(v);
      this.refresh();
    });
    this.quality.addEventListener('change', () => {
      settings.quality = this.quality.value;
      saveSettings(settings);
      this.refresh();
    });
    this.reduceMotion.addEventListener('change', () => {
      settings.reduceMotion = this.reduceMotion.checked;
      saveSettings(settings);
    });
    this.sound.addEventListener('change', () => {
      settings.sound = this.sound.checked;
      saveSettings(settings);
    });
    this.showFps.addEventListener('change', () => {
      settings.showFps = this.showFps.checked;
      saveSettings(settings);
      this.onShowFps(settings.showFps);
    });
  }

  refresh() {
    for (const b of this.fpsSeg.querySelectorAll('button')) {
      b.classList.toggle('active', Number(b.dataset.value) === this.settings.fps);
    }
    this.quality.value = this.settings.quality;
    this.showFps.checked = this.settings.showFps;
    this.reduceMotion.checked = this.settings.reduceMotion;
    this.sound.checked = this.settings.sound;
    const q = resolveQuality(this.settings.quality, this.device);
    const notes = [];
    if (this.settings.quality !== this.initialQuality) notes.push('Kalite değişikliği "Kapat" ile oyun yeniden yüklenince uygulanır.');
    else notes.push(`Etkin kalite: ${q.label} · render ölçeği ≤ ${q.pixelRatioCap} · gölge ${q.shadowSize || 'kapalı'}`);
    if (this.engine.batterySaver) notes.push('Düşük pil: FPS 30 ile sınırlandı.');
    this.note.textContent = notes.join(' ');
  }

  open() {
    this.refresh();
    this.root.hidden = false;
    this.onOpenChange(true);
  }

  close() {
    this.root.hidden = true;
    if (this.settings.quality !== this.initialQuality) {
      // Antialias gibi ayarlar WebGL bağlamı oluşturulurken sabitlenir
      window.location.reload();
      return;
    }
    this.onOpenChange(false);
  }

  get isOpen() { return !this.root.hidden; }
}
