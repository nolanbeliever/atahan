import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { CHAT_RULES } from '/shared/chat.js';

const FADE_MS = 12_000; // kutu kapalıyken mesaj bu kadar sonra solar
const MAX_LINES = 40;

/** Kelime kaydırarak en fazla `maxLines` satır (sığmayan sona "…") */
function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width <= maxW) {
      line = t;
      continue;
    }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines || (lines.length === maxLines && lines.join(' ').length < text.length)) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

/** Oyuncunun başının üstündeki konuşma balonu (tek kanvas dokulu sprite) */
function makeBubble(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.font = '600 34px system-ui, sans-serif';
  const lines = wrap(ctx, text, 460, 2);
  const h = 30 + lines.length * 42;
  const y0 = (c.height - h - 18) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(8, y0, 496, h, 22);
  ctx.fill();
  ctx.beginPath(); // kuyruk
  ctx.moveTo(240, y0 + h);
  ctx.lineTo(256, y0 + h + 18);
  ctx.lineTo(272, y0 + h);
  ctx.fill();
  ctx.fillStyle = '#1b2230';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, 256, y0 + 36 + i * 42));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.47, 1);
  sprite.position.y = 2.3;
  sprite.renderOrder = 4;
  return sprite;
}

/**
 * Oyuncular arası yazılı sohbet.
 *  - Masaüstünde Enter (mobilde 💬) kutuyu açar; Enter gönderir, Esc / boş Enter kapatır.
 *    Yazarken oyun tuşları (WASD, E…) çalışmaz; kapanınca kaldığın yerden devam edersin.
 *  - Sol altta son mesajlar; kutu kapalıyken 12 sn sonra solar. Yeni bağlanan son 30 mesajı görür.
 *  - Yazanın başının üstünde 6 sn konuşma balonu çıkar (yalnızca o anda; sürekli çizim yok).
 *  - Sunucu mesajı temizler, kaba kelimeleri yıldızlar, art arda spam'i engeller.
 */
export class ChatSystem {
  constructor({ engine, net, hud, input, remotes, device, settings, sfx }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.input = input;
    this.remotes = remotes;
    this.device = device;
    this.settings = settings;
    this.sfx = sfx;
    this.selfId = null;
    this.openState = false;
    this.bubbles = new Map(); // oyuncu id → { sprite, timer }

    const $ = (id) => document.getElementById(id);
    this.el = { box: $('chat'), log: $('chat-log'), form: $('chat-form'), input: $('chat-input'), btn: $('btn-chat') };
    this.el.input.maxLength = CHAT_RULES.MAX_LEN;
    this.el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.send();
    });
    this.el.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // oyun tuşları yazarken tetiklenmesin
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.el.input.addEventListener('blur', () => {
      // Mobilde klavye "Bitti" ile kapanınca kutu da kapansın (boşsa)
      if (this.openState && !this.el.input.value.trim()) setTimeout(() => this.close(), 120);
    });
    this.el.btn.addEventListener('click', () => (this.openState ? this.close() : this.open()));
    if (device.touch) this.el.input.placeholder = 'Mesaj yaz…';
  }

  /** input.onCommand zinciri: Enter → sohbet kutusu */
  command(cmd) {
    if (cmd !== 'chat') return false;
    this.open();
    return true;
  }

  open() {
    if (this.openState) return;
    this.openState = true;
    this.input.clear(); // basılı kalan yürüme tuşları bırakılsın
    this.el.box.classList.add('open');
    this.el.form.hidden = false;
    this.el.input.value = '';
    this.el.input.focus();
    this.scroll();
  }

  close() {
    if (!this.openState) return;
    this.openState = false;
    this.el.box.classList.remove('open');
    this.el.form.hidden = true;
    this.el.input.blur();
    this.refreshFade();
  }

  async send() {
    const text = this.el.input.value.trim();
    if (!text) {
      this.close();
      return;
    }
    this.el.input.value = '';
    const res = await this.net.request(EVT.CHAT_SEND, { text });
    if (!res.ok) {
      this.hud.toast(res.error || 'Mesaj gönderilemedi.', 'warn');
      if (this.openState) this.el.input.value = text;
      return;
    }
    this.close();
  }

  // ---- Mesajlar ------------------------------------------------------------------------

  /** snapshot.chat (yeni bağlantı): geçmişi baştan yaz */
  setHistory(list) {
    this.el.log.replaceChildren();
    for (const m of list ?? []) this.addLine(m, true);
    this.scroll();
  }

  /** EVT.CHAT */
  onMessage(m) {
    this.addLine(m, false);
    this.scroll();
    if (m.id !== this.selfId) this.showBubble(m.id, m.text);
  }

  addLine(m, old) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    if (old) line.classList.add('faded');
    const name = document.createElement('b');
    name.textContent = `${m.name}: `;
    name.style.color = m.color || '#ffd27a';
    const text = document.createElement('span');
    text.textContent = m.text; // asla innerHTML
    line.append(name, text);
    this.el.log.append(line);
    while (this.el.log.childElementCount > MAX_LINES) this.el.log.firstElementChild.remove();
    if (!old) line.dataset.t = String(performance.now());
    this.refreshFade();
  }

  scroll() {
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  /** Kutu kapalıyken eski mesajları soldur (tek zamanlayıcı; motoru uyandırmaz) */
  refreshFade() {
    clearTimeout(this.fadeTimer);
    if (this.openState) return;
    const now = performance.now();
    let next = Infinity;
    for (const line of this.el.log.children) {
      const t = Number(line.dataset.t || 0);
      const left = t + FADE_MS - now;
      if (left <= 0) line.classList.add('faded');
      else next = Math.min(next, left);
    }
    if (next < Infinity) this.fadeTimer = setTimeout(() => this.refreshFade(), next + 50);
  }

  // ---- Konuşma balonu ---------------------------------------------------------------------

  showBubble(id, text) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.removeBubble(id);
    const sprite = makeBubble(text);
    r.obj.add(sprite);
    if (r.label) r.label.visible = false; // balon isim etiketinin yerini alır
    const timer = setTimeout(() => this.removeBubble(id), CHAT_RULES.BUBBLE_MS);
    this.bubbles.set(id, { sprite, timer, obj: r.obj, label: r.label });
    this.engine.requestRender();
  }

  removeBubble(id) {
    const b = this.bubbles.get(id);
    if (!b) return;
    clearTimeout(b.timer);
    b.obj.remove(b.sprite);
    b.sprite.material.map.dispose();
    b.sprite.material.dispose();
    if (b.label) b.label.visible = true;
    this.bubbles.delete(id);
    this.engine.requestRender();
  }

  reset(selfId) {
    this.selfId = selfId;
    for (const id of [...this.bubbles.keys()]) this.removeBubble(id);
  }
}
