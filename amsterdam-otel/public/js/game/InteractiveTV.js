import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { EVT } from '/shared/constants.js';
import { parseYouTubeId, isYouTubeId } from '/shared/house.js';
import { SHARED_HOUSE_ID } from '/shared/layout.js';

// iframe'in CSS piksel boyutu. YouTube kaliteyi oynatıcı boyutuna göre seçer:
// telefonda (ya da "Düşük" kalitede) 640×360 → ~360p, daha az veri ve kod çözme.
const FRAME_LARGE = Object.freeze({ w: 1280, h: 720 });
const FRAME_SMALL = Object.freeze({ w: 640, h: 360 });
// Video yüzeyi ekran mesh'inin bu kadar önünde (m): kenarda z-fighting olmasın
const SCREEN_OFFSET = 0.002;
const THUMB_CACHE = 20;

const _off = new THREE.Matrix4();
const _px = new THREE.Matrix4();

/**
 * Evlerdeki televizyonlar: YouTube linki yapıştırıp video / şarkı açma.
 * (Eski TvSystem'in yerini alır; public API ve davranış aynı, video artık TV'nin içinde.)
 *
 *  - Video, YouTube'un resmi gömülü oynatıcısıyla (youtube-nocookie.com) çalar.
 *    WebGL dokusuna video çizilemediği (çapraz köken) için oynatıcı bir iframe'dir;
 *    Three.js CSS3DRenderer ile TV ekranı mesh'inin dünya matrisine hizalanır,
 *    yani video 3D sahnede TV'nin üstünde oynar. CSS3D katmanı canvas'ın üstünde,
 *    HUD'un altındadır ve dokunuşları yutmaz (kontrol panelden ve T tuşundan).
 *  - CSS3D yalnızca motor bir kare çizdiğinde (Engine after-render kancası)
 *    güncellenir: ayrı bir döngü yoktur, motor uyurken kamera da oynamıyordur.
 *    Video oynarken motor sürekli çizmez; iframe kendi kompozitöründe akar.
 *  - Duvarların arkasından görünmesin diye iframe yalnızca oyuncu TV ile aynı
 *    evin içindeyken görünür. Aynı anda en fazla bir iframe vardır.
 *  - 3D TV ekranında (video yüklenmemişken) videonun küçük resmi görünür
 *    (sunucu vekili üzerinden).
 *  - Sunucu her TV için { videoId, başlangıç zamanı } tutar; evdeki diğer
 *    oyuncular "▶ Katıl" ile aynı saniyeden izler (otomatik sesli oynatma
 *    tarayıcılarca engellendiği için iframe yalnızca bir kullanıcı hareketiyle
 *    — T, panel açılışı, Katıl dokunuşu — oluşturulur).
 *  - Evden çıkınca iframe tamamen kaldırılır (ses kesilir, pil/veri harcamaz).
 */
export class InteractiveTV {
  constructor({ net, hud, modal, engine, device, settings }) {
    this.device = device;
    this.settings = settings;
    this.net = net;
    this.hud = hud;
    this.modal = modal;
    this.engine = engine;
    this.house = null; // HouseSystem bağlanınca atanır
    this.inside = false;
    this.houseId = null; // içinde bulunulan ev (onEnterHouse)
    this.panelItem = null; // panel açıkken hangi TV
    this.current = null; // { itemId, houseId, videoId, title, obj } — yüklü oynatıcı
    this.offer = null; // { itemId, video } — katılma önerisi
    this.thumbMats = new Map(); // videoId → material
    this.frame = device?.phone || settings?.quality === 'low' ? FRAME_SMALL : FRAME_LARGE;

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('tv-panel'),
      link: $('tv-link'),
      msg: $('tv-msg'),
      now: $('tv-now'),
      play: $('tv-play'),
      stop: $('tv-stop'),
      chip: document.createElement('button'),
    };

    // "▶ Katıl (T)" / "📺 … · T: kapat" çipi (HUD katmanında, tıklanabilir)
    const chip = this.el.chip;
    chip.type = 'button';
    chip.id = 'tv-chip';
    chip.className = 'tv-chip';
    chip.hidden = true;
    chip.addEventListener('click', () => {
      this.command('tv');
      chip.blur(); // odakta kalırsa sonraki Enter / Boşluk çipi yeniden tetikler
    });
    ($('hud') || document.body).append(chip);

    this.el.play.addEventListener('click', () => this.play());
    this.el.stop.addEventListener('click', () => this.stop());
    $('tv-close').addEventListener('click', () => this.modal.close(this.el.panel));
    this.el.link.addEventListener('keydown', (e) => {
      // Oyun tuşları (WASD, E, F…) yazarken tetiklenmesin; Esc ise paneli kapatabilsin
      if (e.key !== 'Escape') e.stopPropagation();
      if (e.key === 'Enter') this.play();
    });

    // CSS3D katmanı: ana sahneden ayrı, yalnızca iframe'i taşıyan küçük bir sahne
    const root = document.createElement('div');
    root.id = 'tv-css3d';
    root.setAttribute('aria-hidden', 'true');
    document.body.append(root);
    this.css = new CSS3DRenderer({ element: root });
    this.css.setSize(window.innerWidth, window.innerHeight);
    this.cssScene = new THREE.Scene();
    engine.addAfterRender(() => this.renderCss());
    engine.onResize((w, h) => this.onResize(w, h));
  }

  /**
   * T tuşu (ya da çip): yayına katıl ya da yüklü videoyu kapat. Masaüstünde fare
   * oyuna kilitliyken ekrandaki butonlara tıklanamadığı için klavye yolu şart.
   * Tuşa basmak kullanıcı hareketi sayılır → sesli oynatma serbest.
   */
  command(cmd) {
    if (cmd !== 'tv') return false;
    if (this.current) {
      this.unload();
      this.offer = null;
    } else {
      // Kapatılan yayına T ile geri dönülebilsin: öneri yoksa evde çalan en son TV
      const o = this.inside ? (this.offer || this.latestPlaying()) : null;
      if (o) this.load(o.itemId, o.video);
      else if (this.inside) this.hud.toast('Bu evde açık bir TV yok. Televizyona bakıp E ile YouTube aç.', 'info');
      else this.hud.toast('Açık bir TV yok. Bir evdeki televizyona bakıp E ile YouTube aç.', 'info');
    }
    this.renderUi();
    return true;
  }

  /** Evde en son açılan video { itemId, video } ya da null */
  latestPlaying(tvs = this.house?.tvItems(this.houseId) ?? []) {
    const playing = tvs.filter((t) => t.video).sort((a, b) => b.video.startedAt - a.video.startedAt)[0];
    return playing ? { itemId: playing.id, video: playing.video } : null;
  }

  /** Eşyanın evi (houseId'siz eski kayıtlar Bizim Ev'indir) */
  houseOf(item) {
    return item?.houseId ?? SHARED_HOUSE_ID;
  }

  /** Oyuncunun şu an içinde olduğu ev (HouseSystem bilir; yoksa son onEnterHouse) */
  playerHouseId() {
    const h = this.house?.houseId;
    if (h !== undefined) return h;
    return this.inside ? this.houseId : null;
  }

  /** İstemci ipucu: bu TV'yi kumanda edebilir miyim? (sunucu yine doğrular) */
  canUse(item) {
    return this.house?.canUseTv ? this.house.canUseTv(this.houseOf(item)) !== false : true;
  }

  // ---- Panel (alt sayfa: arkadaki TV ekranı görünür kalır) -----------------------

  open(item) {
    this.panelItem = item.id;
    this.el.link.value = '';
    const allowed = this.canUse(item);
    this.el.link.disabled = !allowed;
    this.el.play.disabled = !allowed;
    this.el.stop.disabled = !allowed;
    this.el.msg.textContent = allowed ? '' : 'Bu TV\'yi yalnızca ev sahibi ve içeri aldığı misafirler kumanda edebilir.';
    this.updateNow(item);
    this.modal.open(this.el.panel, () => this.onPanelClosed());
    // Panel açılışı bir kullanıcı hareketi (E / dokunuş) → sesli oynatma serbest
    if (item.video && (!this.current || this.current.itemId !== item.id || this.current.videoId !== item.video.id)) {
      this.load(item.id, item.video);
    }
    this.renderUi();
  }

  onPanelClosed() {
    this.panelItem = null;
    this.renderUi();
  }

  updateNow(item) {
    this.el.now.textContent = item.video
      ? `▶ Şu an: ${item.video.title || item.video.id} — ${item.video.by || ''}`
      : 'TV kapalı. Bir YouTube linki yapıştır.';
  }

  async play() {
    const itemId = this.panelItem;
    if (itemId === null || this.el.play.disabled) return;
    const link = this.el.link.value;
    const id = parseYouTubeId(link);
    if (!id) {
      this.el.msg.textContent = 'Geçerli bir YouTube linki yapıştır (youtube.com/watch?v=… ya da youtu.be/…).';
      return;
    }
    // Tıklama anında yükle (tarayıcıların sesli oynatma kuralı için); sunucu reddederse geri al
    this.load(itemId, { id, startedAt: this.net.serverNow(), title: null });
    this.el.msg.textContent = 'Açılıyor…';
    const res = await this.net.request(EVT.HOUSE_TV_SET, { itemId, link });
    if (!res.ok) {
      this.el.msg.textContent = res.error || 'Açılamadı.';
      if (this.current?.videoId === id) this.unload();
      this.renderUi();
      return;
    }
    this.el.msg.textContent = '';
    this.el.link.value = '';
  }

  async stop() {
    if (this.panelItem === null || this.el.stop.disabled) return;
    const res = await this.net.request(EVT.HOUSE_TV_STOP, { itemId: this.panelItem });
    if (!res.ok) this.el.msg.textContent = res.error || 'Durdurulamadı.';
  }

  // ---- Sunucudan gelen durum -------------------------------------------------------

  /** TV'nin video durumu değişti (herkese yayın; başka evlerin TV'leri de gelir) */
  onState(item) {
    if (this.panelItem === item.id) this.updateNow(item);
    if (!this.inside || this.houseOf(item) !== this.houseId) return;
    const v = item.video;
    if (!v) {
      if (this.current?.itemId === item.id) this.unload();
      if (this.offer?.itemId === item.id) this.offer = null;
    } else if (this.current?.itemId === item.id) {
      if (this.current.videoId !== v.id) this.load(item.id, v);
      else this.current.title = v.title;
    } else if (this.panelItem === item.id) {
      this.load(item.id, v);
    } else {
      this.offer = { itemId: item.id, video: v };
      this.hud.toast(`📺 ${v.by || 'Biri'} TV'de bir şey açtı: ${v.title || v.id}`, 'info');
    }
    this.renderUi();
  }

  onTvRemoved(itemId) {
    if (this.current?.itemId === itemId) this.unload();
    if (this.offer?.itemId === itemId) this.offer = null;
    if (this.panelItem === itemId) this.modal.close(this.el.panel);
    this.renderUi();
  }

  /**
   * Oyuncu bir evin içine girdi.
   * @param {string} houseId
   * @param {object[]} [tvs] o evin TV eşyaları (verilmezse house.tvItems(houseId))
   */
  onEnterHouse(houseId, tvs) {
    // Başka bir evin oynatıcısı kalmasın (normalde evden çıkarken zaten kaldırılır)
    if (this.current && this.current.houseId !== houseId) this.unload();
    this.inside = true;
    this.houseId = houseId ?? null;
    this.offer = this.current ? null : this.latestPlaying(tvs ?? this.house?.tvItems(this.houseId) ?? []);
    this.renderUi();
  }

  /**
   * Yeniden bağlanınca (WELCOME) gelen tam ev durumuyla eşitle: bağlantı
   * kopukken kaldırılan / durdurulan / değiştirilen TV'nin oynatıcısı kalmasın.
   * @param items Map<id, item>
   */
  reconcile(items) {
    const tvAt = (id) => {
      const it = items.get(id);
      return it?.type === 'tv' ? it : null;
    };
    if (this.panelItem !== null) {
      const it = tvAt(this.panelItem);
      if (it) this.updateNow(it);
      else this.modal.close(this.el.panel);
    }
    if (this.current) {
      const it = tvAt(this.current.itemId);
      if (!it?.video) this.unload();
      else if (it.video.id !== this.current.videoId) this.load(it.id, it.video);
    }
    this.offer = this.inside && !this.current
      ? this.latestPlaying([...items.values()].filter((it) => it.type === 'tv' && this.houseOf(it) === this.houseId))
      : null;
    this.renderUi();
  }

  onLeaveHouse() {
    this.inside = false;
    this.houseId = null;
    this.unload();
    this.offer = null;
    if (this.panelItem !== null) this.modal.close(this.el.panel);
    this.renderUi();
  }

  // ---- Oynatıcı (CSS3D iframe) ---------------------------------------------------------

  load(itemId, video) {
    if (!isYouTubeId(video.id)) return;
    const start = Math.max(0, Math.floor((this.net.serverNow() - (video.startedAt || 0)) / 1000));
    const params = new URLSearchParams({
      autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', start: String(start),
      // iframe tıklanmaz (pointer-events: none): kontrol çubuğu / klavye / tam ekran gereksiz
      controls: '0', disablekb: '1', fs: '0', iv_load_policy: '3',
    });
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?${params}`;
    iframe.title = 'YouTube oynatıcı';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube gömme için gerekli
    iframe.tabIndex = -1; // odak iframe'e geçip oyun tuşlarını yutmasın

    const screen = document.createElement('div');
    screen.className = 'tv-screen';
    screen.style.width = `${this.frame.w}px`;
    screen.style.height = `${this.frame.h}px`;
    screen.append(iframe);
    const obj = new CSS3DObject(screen);
    screen.style.pointerEvents = 'none'; // CSS3DObject 'auto' yapar; dokunuşları yutmasın
    obj.matrixAutoUpdate = false;

    this.unload(); // aynı anda en fazla bir iframe
    this.cssScene.add(obj);
    const item = this.house?.items.get(itemId);
    const houseId = item ? this.houseOf(item) : this.houseId;
    this.current = { itemId, houseId, videoId: video.id, title: video.title, obj };
    if (this.offer?.itemId === itemId) this.offer = null;
    // Hemen DOM'a eklensin (kullanıcı hareketi anında; motor duraklatılmış olabilir: panel)
    this.renderCss();
    this.renderUi();
  }

  unload() {
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    // 'removed' olayı elemanı DOM'dan söker → iframe kapanır, ses kesilir
    this.cssScene.remove(cur.obj);
    cur.obj.element.remove();
  }

  /**
   * Engine after-render kancası (ve durum değişince tek seferlik): iframe'i TV
   * ekranının dünya matrisine hizalar. Yüklü video yoksa hiçbir iş yapmaz.
   */
  renderCss() {
    const cur = this.current;
    if (!cur) return;
    const mesh = this.house?.screens?.get(cur.itemId);
    const show = !!mesh && this.playerHouseId() === cur.houseId;
    cur.obj.visible = show; // görünmezken display:none (iframe kaldırılmaz)
    if (show) {
      // Ekran: PlaneGeometry(1,1), scale = (w, h, 1) m. Eleman piksellerini 1×1'e indir,
      // ekranın 2 mm önüne it, ekranın dünya dönüşümünü uygula.
      mesh.updateWorldMatrix(true, false);
      cur.obj.matrix.copy(mesh.matrixWorld)
        .multiply(_off.makeTranslation(0, 0, SCREEN_OFFSET))
        .multiply(_px.makeScale(1 / this.frame.w, 1 / this.frame.h, 1));
      cur.obj.matrixWorldNeedsUpdate = true;
    }
    this.css.render(this.cssScene, this.engine.camera);
  }

  /** Engine.resize kancası (debounce'lu, aynı boyutlar) */
  onResize(w, h) {
    this.css.setSize(w, h);
    if (!this.current || !this.engine.paused) return; // motor zaten bir kare çizecek
    // Panel açıkken motor duraklatılmış: canvas yeniden boyutlanınca silinir, arkadaki
    // TV'li sahne tek kare çizilsin. Diğer durumlarda yalnızca iframe hizalanır.
    if (this.panelItem !== null) this.engine.renderOnce();
    else this.renderCss();
  }

  /** Katıl / şu an çalıyor çipi (eski mini oynatıcının yerine) */
  renderUi() {
    const chip = this.el.chip;
    const touch = this.device?.touch;
    const showOffer = !this.current && !!this.offer && this.inside;
    const showNow = !!this.current && this.panelItem === null;
    chip.hidden = !(showOffer || showNow);
    chip.classList.toggle('join', showOffer);
    if (showOffer) {
      chip.textContent = `${touch ? '▶ Katıl' : '▶ Katıl (T)'} — ${this.offer.video.title || 'TV açık'}`;
      chip.title = 'Evdeki TV yayınına katıl';
    } else if (showNow) {
      const name = this.current.title || 'YouTube';
      chip.textContent = touch ? `📺 ${name} · ✕` : `📺 ${name} · T: kapat`;
      chip.title = 'Videoyu kendin için kapat';
    }
  }

  // ---- 3D ekran (küçük resim) ------------------------------------------------------------

  /** TV ekranına videonun küçük resmini (ya da kapalı ekranı) koy */
  syncScreen(item) {
    if (!this.house) return;
    const v = item.video;
    if (!v || !isYouTubeId(v.id)) {
      this.house.setScreenMaterial(item.id, null);
      return;
    }
    let mat = this.thumbMats.get(v.id);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: 0x202733 });
      this.thumbMats.set(v.id, mat);
      new THREE.TextureLoader().load(`/yt/thumb/${v.id}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
        this.engine.requestRender();
      }, undefined, () => { /* küçük resim yoksa düz ekran kalır */ });
      if (this.thumbMats.size > THUMB_CACHE) {
        // En eskiyi at — ama hâlâ bir TV ekranında duruyorsa dokunma (aksi halde ekran bozulur)
        const inUse = new Set([...this.house.screens.values()].map((m) => m.material));
        for (const [oldId, oldMat] of this.thumbMats) {
          if (oldMat === mat || inUse.has(oldMat)) continue;
          oldMat.map?.dispose();
          oldMat.dispose();
          this.thumbMats.delete(oldId);
          break;
        }
      }
    }
    this.house.setScreenMaterial(item.id, mat);
  }
}
