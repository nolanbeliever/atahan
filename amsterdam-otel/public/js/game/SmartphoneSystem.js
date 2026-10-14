import { DAY_NAMES, formatClock, formatMoney, ROOM_STATUS } from '/shared/constants.js';
import { areaAt } from '/shared/layout.js';
import { INSTA, placeLabel, isPhotoDataUrl } from '/shared/marketing.js';

const STORE_KEY = 'amsterdam-otel:phone:gallery:v1';
const TARGET_LEN = 80_000; // ~60 KB JPEG (base64 data URL uzunluğu)
const SWIPE_PX = 40; // ana çubukta yukarı kaydırma eşiği

/**
 * Oyun içi akıllı telefon (masaüstünde P, dokunmatikte 📱).
 *
 *  - Telefon açıkken modal desenini kullanır (main.js `modal.open`): 3D motor DURUR, fare kilidi
 *    bırakılır, girdi kapanır → ekranda yalnızca DOM var, GPU dinlenir (pil).
 *  - 📷 Kamera vizörü tek istisnadır: telefon çerçevesi küçük bir vizör katmanına iner, motor çalışır
 *    (nişan almak için etrafa bakılır) ama yürünmez (PlayerController.lockUntil). Space / tık / 📸 Çek
 *    deklanşöre basar.
 *  - Çekim: WebGL tuvali `preserveDrawingBuffer: false` ile açılır; bu yüzden TEK kare çizilir
 *    (engine.draw) ve AYNI görevde 2B bir tuvale kopyalanır (drawImage) → 16:9 kırpılıp en fazla
 *    640×360'a küçültülür → JPEG (~0.7, hedef ≤ 60 KB; büyükse kalite düşürülür). Beyaz flaş + WebAudio
 *    deklanşör sesi. Fotoğrafın konusu oyuncunun durduğu yerden bulunur (layout.areaAt).
 *  - Galeri: en fazla 12 fotoğraf, yalnızca bu tarayıcıda (localStorage, try/catch; yer yoksa bellekte).
 *  - Uygulamalar: 📷 Kamera, 🖼️ Galeri, 📸 InstaHotel (InstaHotelMarketing.js), 🏨 Otel (salt okunur).
 *  - Saat çubuğu yalnızca telefon açıkken saniyede bir güncellenir; kapalıyken hiçbir zamanlayıcı yok.
 */
export class SmartphoneSystem {
  constructor({ engine, input, player, modal, device, settings, sfx, state, net, hud, house, reception, touch }) {
    Object.assign(this, { engine, input, player, modal, device, settings, sfx, state, net, hud, house, reception, touch });
    this.apps = [];
    this.current = null; // açık uygulama { id, ... } (null → ana ekran)
    this.isOpen = false;
    this.viewfinder = false;
    this.toCamera = false; // modal kapanışı vizöre geçiş için mi
    this.clockTimer = 0;
    this.gallery = this.loadGallery();
    this.battery = null;
    this.onShare = null; // (photo) => void — InstaHotel "Yeni gönderi"yi bu fotoğrafla açar

    const $ = (id) => document.getElementById(id);
    this.el = {
      root: $('phone'), frame: document.querySelector('#phone .phone-frame'), time: $('phone-time'), battery: $('phone-battery'),
      home: $('phone-home'), bigTime: $('phone-big-time'), date: $('phone-date'), apps: $('phone-apps'),
      app: $('phone-app'), appTitle: $('phone-app-title'), appBody: $('phone-app-body'), back: $('phone-back'),
      homebar: $('phone-homebar'), btn: $('btn-phone'),
      cam: $('phone-cam'), camPlace: $('cam-place'), camShutter: $('cam-shutter'), camClose: $('cam-close'),
      camGallery: $('cam-gallery'), camThumb: $('cam-thumb'), camHint: $('cam-hint'), flash: $('cam-flash'),
    };

    // Yerleşik uygulamalar (InstaHotel kendini registerApp ile ekler)
    this.registerApp({ id: 'camera', icon: '📷', name: 'Kamera', launch: () => this.enterViewfinder() });
    this.registerApp({ id: 'gallery', icon: '🖼️', name: 'Galeri', render: (body) => this.renderGallery(body) });
    this.registerApp({ id: 'hotel', icon: '🏨', name: 'Otel', render: (body) => this.renderHotel(body), order: 9 });

    this.el.btn.addEventListener('click', () => this.toggle());
    this.el.back.addEventListener('click', () => this.showHome());
    // Arka plana dokununca kapanır
    this.el.root.addEventListener('pointerdown', (e) => { if (e.target === this.el.root) this.close(); });
    this.bindHomebar();
    // Yazarken oyun tuşları (WASD, P, Esc → duraklat) tetiklenmesin
    this.el.root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        t.blur();
      }
    });
    // Telefon açıkken P kapatır (girdi kapalı olduğundan KeyboardMouse görmez). Yakalama aşamasında
    // işlenip durdurulur: aynı tuş vuruşu kapanan telefonu yeniden açmasın.
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.code !== 'KeyP' || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }, true);

    // Vizör denetimleri
    const press = (el, fn) => el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    press(this.el.camShutter, () => this.shoot());
    press(this.el.camClose, () => this.exitViewfinder());
    press(this.el.camGallery, () => this.exitViewfinder('gallery'));
    this.el.camHint.textContent = device.touch ? '📸 Çek ile fotoğraf · ✕ telefona dön' : 'Space / tık: çek · P / Esc: telefona dön';

    navigator.getBattery?.().then((b) => { this.battery = b; }).catch(() => {});
    this.renderApps();
    this.updateThumb();
  }

  registerApp(app) {
    this.apps.push({ order: 5, ...app });
    this.apps.sort((a, b) => a.order - b.order);
    if (this.el) this.renderApps();
  }

  // ---- Aç / kapat ------------------------------------------------------------------------

  toggle() {
    if (this.viewfinder) this.exitViewfinder();
    else if (this.isOpen) this.close();
    else this.open();
  }

  open(appId = null) {
    if (this.isOpen) return;
    this.isOpen = true;
    this.modal.open(this.el.root, () => this.onModalClosed());
    this.tickClock();
    clearInterval(this.clockTimer);
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    if (appId) this.openApp(appId);
    else if (this.current) this.openApp(this.current.id); // son açık uygulamaya dön
    else this.showHome();
  }

  close() {
    if (this.isOpen) this.modal.close(this.el.root);
  }

  /** modal.close geri çağrısı (Esc, P, ana çubuk, arka plan) */
  onModalClosed() {
    this.isOpen = false;
    clearInterval(this.clockTimer);
    this.clockTimer = 0;
    this.current?.onHide?.();
    if (!this.toCamera) this.current = null; // vizöre geçişte uygulama hatırlanmaz; kapanışta ana ekran
  }

  bindHomebar() {
    const bar = this.el.homebar;
    let y0 = null;
    bar.addEventListener('pointerdown', (e) => {
      y0 = e.clientY;
      try { bar.setPointerCapture(e.pointerId); } catch { /* yok say */ }
    });
    bar.addEventListener('pointerup', (e) => {
      if (y0 === null) return;
      const dy = y0 - e.clientY;
      y0 = null;
      // Yukarı kaydır ya da dokun: kapat
      if (dy > SWIPE_PX || Math.abs(dy) < 8) this.close();
    });
    bar.addEventListener('pointercancel', () => { y0 = null; });
  }

  // ---- Ekranlar --------------------------------------------------------------------------

  renderApps() {
    const box = this.el.apps;
    box.replaceChildren();
    for (const app of this.apps) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'phone-app-icon';
      b.dataset.app = app.id;
      const ic = document.createElement('span');
      ic.className = `ico ico-${app.id}`;
      ic.textContent = app.icon;
      const badge = document.createElement('i');
      badge.className = 'badge';
      badge.hidden = true;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = app.name;
      b.append(ic, badge, nm);
      b.addEventListener('click', () => this.openApp(app.id));
      box.append(b);
      app.badgeEl = badge;
    }
  }

  setBadge(appId, n) {
    const app = this.apps.find((a) => a.id === appId);
    if (!app?.badgeEl) return;
    app.badgeEl.hidden = !n;
    app.badgeEl.textContent = n > 9 ? '9+' : String(n);
  }

  showHome() {
    this.current?.onHide?.();
    this.current = null;
    this.el.home.hidden = false;
    this.el.app.hidden = true;
    this.el.frame.classList.remove('app-open');
  }

  openApp(id) {
    const app = this.apps.find((a) => a.id === id);
    if (!app) return;
    if (app.launch) {
      app.launch();
      return;
    }
    if (!this.isOpen) {
      this.open(id);
      return;
    }
    if (this.current && this.current !== app) this.current.onHide?.();
    this.current = app;
    this.el.home.hidden = true;
    this.el.app.hidden = false;
    this.el.frame.classList.add('app-open');
    this.el.app.dataset.app = id;
    this.el.appTitle.textContent = `${app.icon} ${app.name}`;
    this.rerender();
  }

  /** Açık uygulamayı yeniden çiz (uygulama durumu değişince) */
  rerender() {
    const app = this.current;
    if (!app || !this.isOpen) return;
    this.el.appBody.replaceChildren();
    this.el.appBody.scrollTop = 0;
    app.render(this.el.appBody);
  }

  tickClock() {
    const c = this.state.clock;
    const minute = c ? this.state.minuteAt(this.net.serverNow()) : 7 * 60;
    const t = formatClock(minute % 1440);
    this.el.time.textContent = t;
    this.el.bigTime.textContent = t;
    this.el.date.textContent = c ? `${DAY_NAMES[c.day]} · ${c.week}. hafta` : '';
    const lvl = this.battery ? Math.round(this.battery.level * 100) : 100;
    this.el.battery.style.setProperty('--lvl', `${lvl}%`);
    this.el.battery.title = `Pil %${lvl}`;
    this.el.battery.classList.toggle('low', lvl <= 20);
  }

  // ---- Kamera (vizör) ------------------------------------------------------------------------

  enterViewfinder() {
    if (this.viewfinder) return;
    if (this.player.drive) {
      this.hud.toast('Sürerken fotoğraf çekilmez — önce park et.', 'warn');
      return;
    }
    if (this.isOpen) {
      // Modal kapanır: motor çalışır, masaüstünde fare yeniden kilitlenir (tıklama = kullanıcı hareketi)
      this.toCamera = true;
      this.close();
      this.toCamera = false;
    }
    this.startViewfinder();
  }

  startViewfinder() {
    this.viewfinder = true;
    this.input.clear();
    this.savedLock = this.player.lockUntil;
    this.player.lockUntil = Infinity; // yürünmez, bakış serbest
    document.body.classList.add('phone-cam');
    this.el.cam.hidden = false;
    this.updatePlace();
    this.placeTimer = setInterval(() => this.updatePlace(), 700);
    this.engine.requestRender();
  }

  /** @param app vizörden dönülecek uygulama (yoksa ana ekran / son uygulama) */
  exitViewfinder(app = null) {
    if (!this.viewfinder) return false;
    this.viewfinder = false;
    clearInterval(this.placeTimer);
    this.player.lockUntil = this.savedLock ?? 0;
    document.body.classList.remove('phone-cam');
    this.el.cam.hidden = true;
    this.open(app);
    return true;
  }

  /** main.js: fare kilidi vizördeyken düştü (Esc) → telefona dön; Esc tuşu da aynısını yapar */
  onEscape() { return this.exitViewfinder(); }

  /** input.onCommand zinciri (ilk sırada): P → telefon; vizörde diğer komutlar yutulur */
  command(cmd) {
    if (cmd === 'phone') {
      this.toggle();
      return true;
    }
    return this.viewfinder;
  }

  /** input.onAction (ilk sırada): vizörde E / Space / tık / Aksiyon = deklanşör */
  onAction() {
    if (!this.viewfinder) return false;
    this.shoot();
    return true;
  }

  currentArea() {
    const p = this.player.pos;
    return areaAt(p.x, p.z);
  }

  /** Konum etiketi: kendi evinde "Senin evin" */
  labelFor(area) {
    const own = typeof area === 'string' && /^h\d$/.test(area) && this.house?.owners?.get(area)?.playerId === this.house?.selfId;
    return placeLabel(area, { houseName: own ? 'Senin evin' : null });
  }

  updatePlace() {
    const t = `📍 ${this.labelFor(this.currentArea())}`;
    if (this.el.camPlace.textContent !== t) this.el.camPlace.textContent = t;
  }

  shoot() {
    const now = performance.now();
    if (now - (this.lastShot ?? 0) < 600) return; // deklanşör aralığı
    this.lastShot = now;
    let url;
    try {
      url = this.capture();
    } catch (err) {
      console.warn('[Telefon] çekim başarısız:', err);
    }
    if (!url || !isPhotoDataUrl(url)) {
      this.hud.toast('Fotoğraf çekilemedi.', 'warn');
      return;
    }
    const area = this.currentArea();
    const photo = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, url, area, t: Date.now() };
    this.gallery.unshift(photo);
    if (this.gallery.length > INSTA.GALLERY_MAX) this.gallery.length = INSTA.GALLERY_MAX;
    this.saveGallery();
    this.updateThumb();
    this.flash();
    this.shutterSound();
    this.hud.toast(`📸 Fotoğraf çekildi · 📍 ${this.labelFor(area)}`, 'info');
  }

  /**
   * Tek kare çiz + aynı görevde kopyala (preserveDrawingBuffer: false olduğu için tuval bir sonraki
   * kompozitten sonra boşalır). 16:9 orta kırpma, en fazla 640×360, JPEG kalitesi boyuta göre.
   */
  capture() {
    const src = this.engine.renderer.domElement;
    this.engine.draw();
    const W = src.width;
    const H = src.height;
    const aspect = INSTA.PHOTO_W / INSTA.PHOTO_H;
    let sw = W;
    let sh = Math.round(W / aspect);
    if (sh > H) {
      sh = H;
      sw = Math.round(H * aspect);
    }
    const sx = Math.round((W - sw) / 2);
    const sy = Math.round((H - sh) / 2);
    const scale = Math.min(1, INSTA.PHOTO_W / sw);
    const c = this.captureCanvas ?? (this.captureCanvas = document.createElement('canvas'));
    c.width = Math.max(16, Math.round(sw * scale));
    c.height = Math.max(9, Math.round(sh * scale));
    const ctx = c.getContext('2d');
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    let q = INSTA.JPEG_QUALITY;
    let url = c.toDataURL('image/jpeg', q);
    while (url.length > TARGET_LEN && q > 0.35) {
      q -= 0.1;
      url = c.toDataURL('image/jpeg', q);
    }
    if (url.length > INSTA.PHOTO_MAX_LEN) {
      // Son çare: yarı çözünürlük
      const half = document.createElement('canvas');
      half.width = Math.round(c.width / 2);
      half.height = Math.round(c.height / 2);
      half.getContext('2d').drawImage(c, 0, 0, half.width, half.height);
      url = half.toDataURL('image/jpeg', 0.6);
    }
    return url;
  }

  flash() {
    const f = this.el.flash;
    f.hidden = false;
    f.classList.remove('go');
    void f.offsetWidth; // tek seferlik geçişi yeniden başlat
    f.classList.add('go');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { f.hidden = true; f.classList.remove('go'); }, 380);
  }

  /** Deklanşör: kısa gürültü "şak" + mekanik tık (paylaşılan Sfx bağlamı) */
  shutterSound() {
    if (!this.settings.sound) return;
    const ctx = this.sfx.begin(260);
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const out = this.sfx.output(ctx, 0.5);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2200;
      hp.connect(out);
      for (const [dt, len, peak] of [[0, 0.035, 0.9], [0.075, 0.05, 0.6]]) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + dt);
        g.gain.exponentialRampToValueAtTime(peak, t + dt + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + len);
        g.connect(hp);
        this.sfx.noiseSource(ctx, t + dt, len + 0.01).connect(g);
      }
      this.sfx.ping(ctx, out, t, 1800, 0.03, 0.25, 'square');
    } catch { /* ses yok */ }
  }

  // ---- Galeri ------------------------------------------------------------------------

  loadGallery() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter((p) => p && isPhotoDataUrl(p.url) && typeof p.id === 'string' && p.id.length < 40)
        .slice(0, INSTA.GALLERY_MAX)
        .map((p) => ({ id: p.id, url: p.url, area: typeof p.area === 'string' ? p.area.slice(0, 12) : null, t: Number.isFinite(p.t) ? p.t : 0 }));
    } catch {
      return [];
    }
  }

  /** Kota dolarsa en eski fotoğraflar kayda girmez (bellekte kalır) */
  saveGallery() {
    for (let n = this.gallery.length; n >= 0; n--) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(this.gallery.slice(0, n)));
        return;
      } catch { /* yer yok: bir eksik dene */ }
    }
  }

  removePhoto(id) {
    this.gallery = this.gallery.filter((p) => p.id !== id);
    this.saveGallery();
    this.updateThumb();
  }

  updateThumb() {
    const last = this.gallery[0];
    this.el.camThumb.hidden = !last;
    if (last) this.el.camThumb.src = last.url; // yalnızca doğrulanmış data URL
  }

  renderGallery(body) {
    if (!this.gallery.length) {
      body.append(emptyState('🖼️', 'Galeri boş', 'Kamerayla otelin, barın ya da odaların fotoğrafını çek.', 'Kamerayı aç', () => this.enterViewfinder()));
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'ph-gallery';
    for (const photo of this.gallery) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ph-shot';
      const img = document.createElement('img');
      img.alt = '';
      img.src = photo.url;
      const cap = document.createElement('span');
      cap.textContent = `📍 ${this.labelFor(photo.area)}`;
      b.append(img, cap);
      b.addEventListener('click', () => this.renderPhoto(body, photo));
      grid.append(b);
    }
    body.append(grid);
    const note = document.createElement('p');
    note.className = 'ph-note';
    note.textContent = `${this.gallery.length}/${INSTA.GALLERY_MAX} fotoğraf · yalnızca bu cihazda saklanır.`;
    body.append(note);
  }

  renderPhoto(body, photo) {
    body.replaceChildren();
    const img = document.createElement('img');
    img.className = 'ph-big';
    img.alt = '';
    img.src = photo.url;
    const cap = document.createElement('p');
    cap.className = 'ph-place';
    cap.textContent = `📍 ${this.labelFor(photo.area)} · ${new Date(photo.t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
    const row = document.createElement('div');
    row.className = 'ph-row';
    row.append(
      button('📸 InstaHotel\'de paylaş', 'primary', () => this.onShare?.(photo)),
      button('🗑 Sil', 'secondary', () => {
        this.removePhoto(photo.id);
        this.rerender();
      }),
      button('‹ Galeri', 'secondary', () => this.rerender()),
    );
    body.append(img, cap, row);
  }

  // ---- Otel (salt okunur) -------------------------------------------------------------------

  renderHotel(body) {
    const g = this.reception?.hotel?.growth ?? { stars: 1, floors: 1, reputation: 0 };
    let occ = 0;
    let total = 0;
    let dirty = 0;
    for (const r of this.state.rooms.values()) {
      if (Number(r.id[0]) > g.floors) continue;
      total++;
      if (r.status === ROOM_STATUS.OCCUPIED) occ++;
      if (r.status === ROOM_STATUS.DIRTY) dirty++;
    }
    const pct = total ? Math.round((occ / total) * 100) : 0;
    const box = document.createElement('div');
    box.className = 'ph-hotel';
    const rows = [
      ['🏦 Kasa', formatMoney(this.state.economy?.money ?? 0)],
      ['⭐ Yıldız', `${'★'.repeat(g.stars)}${'☆'.repeat(5 - g.stars)}`],
      ['🏢 Katlar', `${g.floors} kat · ${total} oda`],
      ['🛏️ Doluluk', `%${pct} (${occ}/${total})`],
      ['🧹 Kirli oda', String(dirty)],
      ['📈 Bugün', formatMoney(this.state.economy?.today?.earned ?? 0)],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      row.className = 'ph-kv';
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('b');
      b.textContent = v;
      row.append(a, b);
      box.append(row);
    }
    const bar = document.createElement('div');
    bar.className = 'ph-occ';
    const fill = document.createElement('i');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    box.append(bar);
    body.append(box);
  }
}

// ---- Küçük DOM yardımcıları (InstaHotelMarketing de kullanır) ----------------------------

export function button(text, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

export function emptyState(icon, title, text, action, fn) {
  const box = document.createElement('div');
  box.className = 'ph-empty';
  const i = document.createElement('div');
  i.className = 'ph-empty-ico';
  i.textContent = icon;
  const h = document.createElement('b');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(i, h, p);
  if (action) box.append(button(action, 'primary', fn));
  return box;
}
