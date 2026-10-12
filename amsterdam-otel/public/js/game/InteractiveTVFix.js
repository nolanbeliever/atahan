// YouTube gömülü oynatıcısıyla konuşan küçük köprü (IFrame Player API'nin postMessage
// protokolü; ek bir <script> yüklemez).
//
// Neden VideoTexture değil: YouTube videosu çapraz kökenli bir iframe'in içinde oynar;
// tarayıcı bu pikselleri WebGL'e (THREE.VideoTexture) vermez. Hareketli görüntü için tek
// yol iframe'i CSS3DRenderer ile TV ekranına oturtmaktır (InteractiveTV bunu yapar).
//
// Bu köprünün düzelttikleri:
//  - Video her zaman HAREKETLİ başlar: tarayıcılar (özellikle iPad/iPhone Safari) sesli
//    otomatik oynatmayı engeller; engellenince oynatıcı ilk karede donup kalıyordu.
//    Artık oynatıcı sessiz (mute=1) açılır — sessiz otomatik oynatma her yerde serbest —
//    hazır olunca sesi açmayı dener. Tarayıcı izin vermezse "🔇 sesi aç" istenir ve ilk
//    dokunuşta (kullanıcı hareketi) ses açılır.
//  - Senkron: oynatıcının bildirdiği süre sunucudaki başlangıç zamanından hesaplanan
//    süreden 2.5 sn'den fazla saparsa (takılma, arka plan sekmesi, yavaş bağlantı)
//    videoya o saniyeden devam ettirilir. Evdeki herkes aynı anı izler.

const ORIGIN = 'https://www.youtube-nocookie.com';
const DRIFT_SEC = 2.5; // bu kadar sapma → seekTo
const SYNC_EVERY_MS = 4000;
const UNMUTE_CHECK_MS = 1600; // sesi açma denemesinden sonra bu kadar bekleyip sonucu kontrol et

/** YouTube oynatıcı durumları (infoDelivery.playerState) */
export const YT_STATE = Object.freeze({ UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 });

/** Linkten değil kimlikten gömme adresi (link → kimlik dönüşümü shared/house.js parseYouTubeId) */
export function embedUrl(videoId, startSec, { controls = false } = {}) {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1', // sessiz başla: otomatik oynatma hiçbir tarayıcıda engellenmez
    playsinline: '1',
    enablejsapi: '1', // postMessage ile komut (unMute, seekTo) ve durum bilgisi
    origin: window.location.origin,
    rel: '0',
    modestbranding: '1',
    start: String(Math.max(0, Math.floor(startSec))),
    controls: controls ? '1' : '0',
    disablekb: '1',
    fs: '0',
    iv_load_policy: '3',
  });
  return `${ORIGIN}/embed/${videoId}?${params}`;
}

/**
 * Tek bir YouTube iframe'i için köprü.
 * @param iframe       <iframe> (src = embedUrl(...))
 * @param expectedTime () => sunucuya göre şu an videonun kaçıncı saniyesinde olunmalı
 * @param onChange     ({ muted, blocked, state }) => void — arayüzü (çip) güncellemek için
 */
export class YouTubeBridge {
  constructor(iframe, { expectedTime, wantSound, onChange }) {
    this.iframe = iframe;
    this.expectedTime = expectedTime;
    this.wantSound = wantSound; // () => boolean (ayarlarda ses açık mı)
    this.onChange = onChange;
    this.ready = false;
    this.muted = true;
    this.blocked = false; // sesi açma denemesi tarayıcıca engellendi → kullanıcı dokunuşu gerek
    this.state = YT_STATE.UNSTARTED;
    this.time = 0;
    this.duration = 0;
    this.lastInfoAt = 0;
    this.disposed = false;

    this.onMessage = (e) => this.handle(e);
    window.addEventListener('message', this.onMessage);
    // iframe yüklenince "dinliyorum" de: oynatıcı infoDelivery olaylarını göndermeye başlar
    this.onLoad = () => this.listen();
    iframe.addEventListener('load', this.onLoad);
    this.syncTimer = setInterval(() => this.sync(), SYNC_EVERY_MS);
  }

  post(msg) {
    const w = this.iframe.contentWindow;
    if (!w || this.disposed) return;
    w.postMessage(JSON.stringify(msg), ORIGIN);
  }

  command(func, args = []) {
    this.post({ event: 'command', func, args, id: 1, channel: 'widget' });
  }

  listen() {
    this.post({ event: 'listening', id: 1, channel: 'widget' });
  }

  handle(e) {
    if (e.source !== this.iframe.contentWindow || e.origin !== ORIGIN || typeof e.data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.event === 'onReady') {
      this.ready = true;
      this.trySound();
    } else if (msg.event === 'infoDelivery' || msg.event === 'initialDelivery') {
      const info = msg.info || {};
      if (!this.ready && msg.event === 'initialDelivery') {
        this.ready = true;
        this.trySound();
      }
      if (typeof info.currentTime === 'number') this.time = info.currentTime;
      if (typeof info.duration === 'number' && info.duration > 0) this.duration = info.duration;
      if (typeof info.playerState === 'number') this.state = info.playerState;
      if (typeof info.muted === 'boolean') this.muted = info.muted;
      this.lastInfoAt = performance.now();
      this.emit();
    }
  }

  /** Ses ayarı açıksa sesi açmayı dene; tarayıcı engellerse sessiz oynamaya devam et */
  trySound() {
    if (!this.wantSound()) {
      this.command('mute');
      this.command('playVideo');
      return;
    }
    this.command('unMute');
    this.command('setVolume', [100]);
    this.command('playVideo');
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      if (this.disposed) return;
      // Engellendiyse oynatıcı ya hâlâ sessizdir ya da sesli oynatmayı reddedip durmuştur
      const stopped = this.state === YT_STATE.PAUSED || this.state === YT_STATE.UNSTARTED || this.state === YT_STATE.CUED;
      if (this.muted || stopped) {
        this.blocked = true;
        this.command('mute');
        this.command('playVideo'); // en azından sessiz ve hareketli oynasın
      } else {
        this.blocked = false;
      }
      this.emit();
    }, UNMUTE_CHECK_MS);
  }

  /** Kullanıcı hareketi (dokunuş, T, buton) içinden çağrılır: sesi aç */
  unmuteFromGesture() {
    this.blocked = false;
    this.command('unMute');
    this.command('setVolume', [100]);
    this.command('playVideo');
    this.emit();
    // Hâlâ olmadıysa (bazı iOS sürümleri) kullanıcı video yüzeyine dokunabilir (InteractiveTV)
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      if (!this.disposed && this.muted) {
        this.blocked = true;
        this.emit();
      }
    }, UNMUTE_CHECK_MS);
  }

  /** Sunucudaki zamana göre sapmayı düzelt */
  sync() {
    if (!this.ready || this.disposed) return;
    // Bilgi gelmiyorsa (iframe yeni yüklendi / oynatıcı uyudu) yeniden dinle
    if (performance.now() - this.lastInfoAt > SYNC_EVERY_MS * 2) this.listen();
    const want = this.expectedTime();
    if (this.duration && want >= this.duration - 1) return; // video bitti; sona sarmaya gerek yok
    if (this.state === YT_STATE.BUFFERING) return;
    if (Math.abs(this.time - want) > DRIFT_SEC) this.command('seekTo', [want, true]);
    if (this.state === YT_STATE.PAUSED || this.state === YT_STATE.CUED) this.command('playVideo');
  }

  emit() {
    this.onChange?.({ muted: this.muted, blocked: this.blocked, state: this.state });
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.syncTimer);
    clearTimeout(this.checkTimer);
    window.removeEventListener('message', this.onMessage);
    this.iframe.removeEventListener('load', this.onLoad);
  }
}
