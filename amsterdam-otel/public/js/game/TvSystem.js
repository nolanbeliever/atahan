import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { parseYouTubeId, isYouTubeId } from '/shared/house.js';

/**
 * Bizim Ev'deki televizyonlar: YouTube linki yapıştırıp video / şarkı açma.
 *
 *  - Video, YouTube'un resmi gömülü oynatıcısıyla (youtube-nocookie.com) çalar.
 *    WebGL dokusuna video çizilemediği (çapraz köken) için oynatıcı bir DOM
 *    katmanıdır: TV panelinde büyük, panel kapanınca köşede küçük (mini).
 *  - 3D TV ekranında videonun küçük resmi görünür (sunucu vekili üzerinden).
 *  - Sunucu her TV için { videoId, başlangıç zamanı } tutar; evdeki diğer
 *    oyuncular "▶ Katıl" ile aynı saniyeden izler (otomatik sesli oynatma
 *    tarayıcılarca engellendiği için katılım bir dokunuş ister).
 *  - Evden çıkınca oynatıcı tamamen kaldırılır (ses kesilir, pil/veri harcamaz).
 */
export class TvSystem {
  constructor({ net, hud, modal, engine, device }) {
    this.device = device;
    this.net = net;
    this.hud = hud;
    this.modal = modal;
    this.engine = engine;
    this.house = null; // HouseSystem bağlanınca atanır
    this.inside = false;
    this.panelItem = null; // panel açıkken hangi TV
    this.current = null; // { itemId, videoId } — yüklü oynatıcı
    this.offer = null; // { itemId, video } — katılma önerisi
    this.thumbMats = new Map(); // videoId → material

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('tv-panel'),
      link: $('tv-link'),
      msg: $('tv-msg'),
      now: $('tv-now'),
      player: $('tv-player'),
      frame: $('tv-frame'),
      title: $('tv-title'),
      join: $('tv-join'),
    };
    $('tv-play').addEventListener('click', () => this.play());
    $('tv-stop').addEventListener('click', () => this.stop());
    $('tv-close').addEventListener('click', () => this.modal.close(this.el.panel));
    $('tv-hide').addEventListener('click', () => {
      this.unload();
      this.offer = null;
      this.renderPlayer();
    });
    this.el.join.addEventListener('click', () => {
      if (this.offer) this.load(this.offer.itemId, this.offer.video);
    });
    this.el.link.addEventListener('keydown', (e) => {
      // Oyun tuşları (WASD, E, F…) yazarken tetiklenmesin; Esc ise paneli kapatabilsin
      if (e.key !== 'Escape') e.stopPropagation();
      if (e.key === 'Enter') this.play();
    });
  }

  /**
   * T tuşu: yayına katıl ya da mini oynatıcıyı kapat. Masaüstünde fare oyuna
   * kilitliyken ekrandaki butonlara tıklanamadığı için klavye yolu şart.
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
      else this.hud.toast('Açık bir TV yok. Bizim Ev\'deki televizyona bakıp E ile YouTube aç.', 'info');
    }
    this.renderPlayer();
    return true;
  }

  /** Evde en son açılan video { itemId, video } ya da null */
  latestPlaying(tvs = this.house?.tvItems() ?? []) {
    const playing = tvs.filter((t) => t.video).sort((a, b) => b.video.startedAt - a.video.startedAt)[0];
    return playing ? { itemId: playing.id, video: playing.video } : null;
  }

  // ---- Panel ------------------------------------------------------------------

  open(item) {
    this.panelItem = item.id;
    this.el.msg.textContent = '';
    this.el.link.value = '';
    this.updateNow(item);
    this.modal.open(this.el.panel, () => this.onPanelClosed());
    // Panel açılışı bir kullanıcı hareketi (E / dokunuş) → sesli oynatma serbest
    if (item.video && (!this.current || this.current.itemId !== item.id || this.current.videoId !== item.video.id)) {
      this.load(item.id, item.video);
    }
    this.renderPlayer();
  }

  onPanelClosed() {
    this.panelItem = null;
    this.renderPlayer();
  }

  updateNow(item) {
    this.el.now.textContent = item.video
      ? `▶ Şu an: ${item.video.title || item.video.id} — ${item.video.by || ''}`
      : 'TV kapalı. Bir YouTube linki yapıştır.';
  }

  async play() {
    const itemId = this.panelItem;
    if (itemId === null) return;
    const id = parseYouTubeId(this.el.link.value);
    if (!id) {
      this.el.msg.textContent = 'Geçerli bir YouTube linki yapıştır (youtube.com/watch?v=… ya da youtu.be/…).';
      return;
    }
    // Tıklama anında yükle (tarayıcıların sesli oynatma kuralı için); sunucu reddederse geri al
    this.load(itemId, { id, startedAt: this.net.serverNow(), title: null });
    this.el.msg.textContent = 'Açılıyor…';
    const res = await this.net.request(EVT.HOUSE_TV_SET, { itemId, link: this.el.link.value });
    if (!res.ok) {
      this.el.msg.textContent = res.error || 'Açılamadı.';
      if (this.current?.videoId === id) this.unload();
      this.renderPlayer();
      return;
    }
    this.el.msg.textContent = '';
    this.el.link.value = '';
  }

  async stop() {
    if (this.panelItem === null) return;
    const res = await this.net.request(EVT.HOUSE_TV_STOP, { itemId: this.panelItem });
    if (!res.ok) this.el.msg.textContent = res.error || 'Durdurulamadı.';
  }

  // ---- Sunucudan gelen durum -------------------------------------------------------

  /** TV'nin video durumu değişti (herkese yayın) */
  onState(item) {
    if (this.panelItem === item.id) this.updateNow(item);
    if (!this.inside) return;
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
    this.renderPlayer();
  }

  onTvRemoved(itemId) {
    if (this.current?.itemId === itemId) this.unload();
    if (this.offer?.itemId === itemId) this.offer = null;
    if (this.panelItem === itemId) this.modal.close(this.el.panel);
    this.renderPlayer();
  }

  onEnterHouse(tvs) {
    this.inside = true;
    this.offer = this.latestPlaying(tvs);
    this.renderPlayer();
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
    this.offer = this.inside && !this.current ? this.latestPlaying([...items.values()].filter((it) => it.type === 'tv')) : null;
    this.renderPlayer();
  }

  onLeaveHouse() {
    this.inside = false;
    this.unload();
    this.offer = null;
    if (this.panelItem !== null) this.modal.close(this.el.panel);
    this.renderPlayer();
  }

  // ---- Oynatıcı ------------------------------------------------------------------

  load(itemId, video) {
    if (!isYouTubeId(video.id)) return;
    const start = Math.max(0, Math.floor((this.net.serverNow() - (video.startedAt || 0)) / 1000));
    const params = new URLSearchParams({
      autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', start: String(start),
    });
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?${params}`;
    iframe.title = 'YouTube oynatıcı';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube gömme için gerekli
    this.el.frame.replaceChildren(iframe);
    this.current = { itemId, videoId: video.id, title: video.title };
    if (this.offer?.itemId === itemId) this.offer = null;
    this.renderPlayer();
  }

  unload() {
    this.el.frame.replaceChildren();
    this.current = null;
  }

  renderPlayer() {
    const p = this.el.player;
    const big = this.panelItem !== null;
    const showOffer = !this.current && this.offer && this.inside;
    p.hidden = !(this.current || showOffer || (big && this.current));
    p.classList.toggle('big', big && !!this.current);
    p.classList.toggle('mini', !big || !this.current);
    this.el.join.hidden = !showOffer;
    const touch = this.device?.touch;
    if (showOffer) this.el.join.textContent = `${touch ? '▶ Katıl' : '▶ T: Katıl'} — ${this.offer.video.title || 'TV açık'}`;
    const name = this.current ? (this.current.title || 'YouTube') : '📺 TV açık';
    this.el.title.textContent = !touch && this.current && !big ? `${name} · T: kapat` : name;
  }

  // ---- 3D ekran ----------------------------------------------------------------------

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
      if (this.thumbMats.size > 20) {
        const [oldId, oldMat] = this.thumbMats.entries().next().value;
        oldMat.map?.dispose();
        oldMat.dispose();
        this.thumbMats.delete(oldId);
      }
    }
    this.house.setScreenMaterial(item.id, mat);
  }
}
