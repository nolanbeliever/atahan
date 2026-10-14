import { EVT, formatMoney } from '/shared/constants.js';
import { INSTA, AD_BUDGETS, isPhotoDataUrl, formatCount } from '/shared/marketing.js';
import { button, emptyState } from './SmartphoneSystem.js';

const JPEG_SIG = 'data:image/jpeg;base64,/9j/';
const COUNT_MS = 1100; // sayaç animasyonu süresi
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Yalnızca doğrulanmış JPEG data URL'si <img src>'ye girer (başka hiçbir şey çizilmez) */
const safePhoto = (s) => (isPhotoDataUrl(s) && s.startsWith(JPEG_SIG) ? s : null);

function timeAgo(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'şimdi';
  if (s < 3600) return `${Math.floor(s / 60)} dk`;
  if (s < 86_400) return `${Math.floor(s / 3600)} sa`;
  return `${Math.floor(s / 86_400)} g`;
}

const BUDGET_HINT = Object.freeze({
  0: 'Takipçilerin görür · turist akını yok',
  50: '1 gün turist akını · misafir ×2 · bar ×1.5',
  150: '1 gün turist akını · misafir ×3 · bar ×2.2 · bahşiş +%15',
  300: '1 gün turist akını · misafir ×4 · bar ×3 · bahşiş +%30',
});

/**
 * 📸 InstaHotel — telefondaki sosyal medya uygulaması (otel hesabı @hotel.amsterdam).
 *
 *  - Akış: tüm oyuncuların gönderileri (en yeni üstte), profil başlığı (takipçi / gönderi sayısı,
 *    süren kampanya), ❤️ beğeni (oyuncu başına bir kez; sunucu doğrular).
 *  - Yeni gönderi: galeriden fotoğraf seç → açıklama (≤ 200) → bütçe (Organik / €50 / €150 / €300,
 *    otel kasasından) → Paylaş. Kasada yetmeyen ve kampanya sürerken ücretli bütçeler kapalı.
 *  - Güvenlik: tüm metinler textContent ile; fotoğraflar yalnızca doğrulanmış JPEG data URL olarak
 *    <img src>'ye. innerHTML hiç kullanılmaz.
 *  - Ağ / pil: sunucu yalnızca sayaçları yayınlar; sayaçlar telefon açıkken kısa bir rAF animasyonuyla
 *    sayar (kapalıyken doğrudan yazılır). Fotoğrafı WELCOME'da gelmeyen gönderiler akışta göründükçe
 *    (IntersectionObserver) tek tek istenir.
 */
export class InstaHotelMarketing {
  constructor({ net, hud, phone, state, settings, sfx }) {
    Object.assign(this, { net, hud, phone, state, settings, sfx });
    this.account = INSTA.ACCOUNT;
    this.followers = 0;
    this.posts = []; // en yeni önce: { id, by, color, caption, place, budget, likes, t, photo?, noPhoto? }
    this.liked = new Set();
    this.rushUntil = null;
    this.view = 'feed'; // 'feed' | 'compose'
    this.draft = { photoId: null, caption: '', budget: 0 };
    this.unread = 0;
    this.counters = new Map(); // post id → { el, shown } (akıştaki sayaç elemanları)
    this.fetching = new Set();
    this.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => this.onVisible(entries), { rootMargin: '120px' })
      : null;

    phone.registerApp({
      id: 'insta', icon: '📸', name: 'InstaHotel', order: 2,
      render: (body) => this.render(body),
      onHide: () => this.onHide(),
    });
    phone.onShare = (photo) => this.compose(photo.id);
  }

  // ---- Sunucu durumu ---------------------------------------------------------------------

  applySnapshot(s) {
    if (!s) return;
    this.account = typeof s.account === 'string' ? s.account : INSTA.ACCOUNT;
    this.followers = s.followers | 0;
    this.posts = Array.isArray(s.posts) ? s.posts.slice(0, INSTA.FEED_MAX) : [];
    this.liked = new Set(Array.isArray(s.liked) ? s.liked : []);
    this.rushUntil = s.rushUntil ?? null;
    this.refresh();
  }

  /** EVT.INSTA_FEED: yeni gönderi (fotoğrafıyla) */
  onFeed({ post, followers }) {
    if (!post || this.posts.some((p) => p.id === post.id)) return;
    this.posts.unshift(post);
    if (this.posts.length > INSTA.FEED_MAX) this.posts.length = INSTA.FEED_MAX;
    if (Number.isFinite(followers)) this.followers = followers;
    if (!this.selfPosted && !this.visible) {
      this.unread++;
      this.phone.setBadge('insta', this.unread);
    }
    this.selfPosted = false;
    if (this.visible && this.view === 'feed') this.phone.rerender();
  }

  /** EVT.INSTA_STATS: { f, p: [[id, likes]] } — yalnızca sayaçlar */
  onStats({ f, p }) {
    if (Number.isFinite(f)) {
      const before = this.followers;
      this.followers = f;
      if (this.followerEl) this.animate(this.followerEl, before, f);
    }
    for (const [id, likes] of Array.isArray(p) ? p : []) {
      const post = this.posts.find((x) => x.id === id);
      if (!post) continue;
      const before = post.likes;
      post.likes = likes;
      const c = this.counters.get(id);
      if (c) this.animate(c, before, likes);
    }
  }

  setRush(untilTotal) {
    this.rushUntil = untilTotal;
  }

  get visible() { return this.phone.isOpen && this.phone.current?.id === 'insta'; }

  refresh() {
    if (this.visible) this.phone.rerender();
  }

  onHide() {
    this.observer?.disconnect();
    this.counters.clear();
    this.followerEl = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anims = null;
  }

  // ---- Sayaç animasyonu (yalnızca telefon açıkken; kısa rAF) ---------------------------------

  animate(el, from, to) {
    if (!this.visible || !el.isConnected || from === to) {
      el.textContent = formatCount(to);
      return;
    }
    this.anims ??= new Map();
    this.anims.set(el, { from, to, t0: performance.now() });
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.step(t));
  }

  step(now) {
    this.raf = 0;
    if (!this.anims) return;
    for (const [el, a] of this.anims) {
      const k = Math.min(1, (now - a.t0) / COUNT_MS);
      const e = 1 - (1 - k) ** 3;
      el.textContent = formatCount(a.from + (a.to - a.from) * e);
      if (k >= 1) this.anims.delete(el);
    }
    if (this.anims.size) this.raf = requestAnimationFrame((t) => this.step(t));
  }

  // ---- Çizim -----------------------------------------------------------------------------

  render(body) {
    this.onHide();
    this.unread = 0;
    this.phone.setBadge('insta', 0);
    if (this.view === 'compose') this.renderCompose(body);
    else this.renderFeed(body);
  }

  gameTotal() {
    const c = this.state.clock;
    return c ? (c.days ?? 0) * 1440 + this.state.minuteAt(this.net.serverNow()) : 0;
  }

  get rushActive() { return this.rushUntil != null && this.rushUntil > this.gameTotal(); }

  renderFeed(body) {
    const head = document.createElement('div');
    head.className = 'ig-profile';
    const avatar = document.createElement('div');
    avatar.className = 'ig-avatar';
    avatar.textContent = '🌷';
    const info = document.createElement('div');
    info.className = 'ig-info';
    const name = document.createElement('b');
    name.textContent = this.account;
    const stats = document.createElement('div');
    stats.className = 'ig-stats';
    const st = (n, label) => {
      const s = document.createElement('span');
      const v = document.createElement('b');
      v.textContent = formatCount(n);
      s.append(v, document.createTextNode(` ${label}`));
      stats.append(s);
      return v;
    };
    st(this.posts.length, 'gönderi');
    this.followerEl = st(this.followers, 'takipçi');
    info.append(name, stats);
    head.append(avatar, info);
    body.append(head);

    if (this.rushActive) {
      const left = Math.max(0, Math.round(this.rushUntil - this.gameTotal()));
      const rush = document.createElement('div');
      rush.className = 'ig-rush';
      rush.textContent = `📣 Kampanya sürüyor — turist akını · ${Math.floor(left / 60)}sa ${left % 60}dk kaldı`;
      body.append(rush);
    }
    body.append(button('＋ Yeni gönderi', 'primary ig-new', () => this.compose()));

    if (!this.posts.length) {
      body.append(emptyState('📸', 'Henüz gönderi yok', 'Otelin ilk fotoğrafını paylaş — reklam bütçesiyle turist akını başlat!'));
      return;
    }
    const now = this.net.serverNow();
    for (const post of this.posts) body.append(this.postCard(post, now));
  }

  postCard(post, now) {
    const card = document.createElement('article');
    card.className = 'ig-post';
    const top = document.createElement('div');
    top.className = 'ig-top';
    const dot = document.createElement('i');
    dot.className = 'ig-dot';
    dot.style.background = COLOR_RE.test(post.color) ? post.color : '#ff7a1a';
    const by = document.createElement('b');
    by.textContent = String(post.by ?? '');
    const place = document.createElement('small');
    place.textContent = `📍 ${String(post.place ?? '')}`;
    const who = document.createElement('div');
    who.className = 'ig-who';
    who.append(by, place);
    const ago = document.createElement('small');
    ago.className = 'ig-ago';
    ago.textContent = timeAgo(post.t, now);
    top.append(dot, who, ago);

    const media = document.createElement('div');
    media.className = 'ig-media';
    const src = safePhoto(post.photo);
    if (src) {
      const img = document.createElement('img');
      img.alt = post.caption ? String(post.caption).slice(0, 80) : 'InstaHotel fotoğrafı';
      img.decoding = 'async';
      img.src = src;
      media.append(img);
    } else {
      media.classList.add('empty');
      media.textContent = post.noPhoto ? '🗂️ Fotoğraf arşivde' : '⏳';
      if (!post.noPhoto) {
        media.dataset.id = String(post.id);
        this.observer ? this.observer.observe(media) : this.fetchPhoto(post.id);
      }
    }
    // Çift dokunuş = beğen (Instagram gibi)
    media.addEventListener('dblclick', () => this.like(post));

    const actions = document.createElement('div');
    actions.className = 'ig-actions';
    const liked = this.liked.has(post.id);
    const heart = button(liked ? '❤️' : '🤍', `ig-like${liked ? ' on' : ''}`, () => this.like(post));
    heart.setAttribute('aria-label', 'Beğen');
    const count = document.createElement('b');
    count.textContent = formatCount(post.likes);
    this.counters.set(post.id, count);
    const lbl = document.createElement('span');
    lbl.textContent = ' beğeni';
    const likes = document.createElement('span');
    likes.className = 'ig-likes';
    likes.append(count, lbl);
    actions.append(heart, likes);
    if (post.budget > 0) {
      const sp = document.createElement('span');
      sp.className = 'ig-sponsor';
      sp.textContent = `Sponsorlu · ${formatMoney(post.budget)}`;
      actions.append(sp);
    }
    const cap = document.createElement('p');
    cap.className = 'ig-caption';
    const acc = document.createElement('b');
    acc.textContent = `${this.account} `;
    cap.append(acc, document.createTextNode(String(post.caption ?? '')));
    card.append(top, media, actions, cap);
    return card;
  }

  onVisible(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      this.observer.unobserve(e.target);
      const id = Number(e.target.dataset.id);
      if (Number.isInteger(id)) this.fetchPhoto(id);
    }
  }

  async fetchPhoto(id) {
    if (this.fetching.has(id)) return;
    this.fetching.add(id);
    const res = await this.net.request(EVT.INSTA_ACT, { act: 'photo', id });
    this.fetching.delete(id);
    const post = this.posts.find((p) => p.id === id);
    if (!post) return;
    if (res.ok && safePhoto(res.photo)) post.photo = res.photo;
    else post.noPhoto = true;
    if (this.visible && this.view === 'feed') {
      const scroll = this.phone.el.appBody.scrollTop;
      this.phone.rerender();
      this.phone.el.appBody.scrollTop = scroll;
    }
  }

  async like(post) {
    if (this.liked.has(post.id)) return;
    this.liked.add(post.id); // iyimser
    const before = post.likes;
    post.likes += 1;
    this.restyleLike(post);
    if (this.settings.sound) this.sfx.clink?.();
    const res = await this.net.request(EVT.INSTA_ACT, { act: 'like', id: post.id });
    if (!res.ok) {
      if (!/zaten/.test(res.error || '')) {
        this.liked.delete(post.id);
        post.likes = before;
      }
      this.hud.toast(res.error || 'Beğenilemedi.', 'warn');
      this.restyleLike(post);
    }
  }

  restyleLike(post) {
    const c = this.counters.get(post.id);
    if (!c) return;
    c.textContent = formatCount(post.likes);
    const heart = c.closest('.ig-actions')?.querySelector('.ig-like');
    if (!heart) return;
    const on = this.liked.has(post.id);
    heart.textContent = on ? '❤️' : '🤍';
    heart.classList.toggle('on', on);
  }

  // ---- Yeni gönderi ------------------------------------------------------------------------

  compose(photoId = null) {
    this.view = 'compose';
    if (photoId) this.draft.photoId = photoId;
    if (!this.phone.gallery.some((p) => p.id === this.draft.photoId)) this.draft.photoId = this.phone.gallery[0]?.id ?? null;
    if (this.phone.current?.id === 'insta' && this.phone.isOpen) this.phone.rerender();
    else this.phone.openApp('insta');
  }

  renderCompose(body) {
    const back = button('‹ Akışa dön', 'secondary ig-back', () => {
      this.view = 'feed';
      this.phone.rerender();
    });
    body.append(back);
    const gallery = this.phone.gallery;
    if (!gallery.length) {
      body.append(emptyState('📷', 'Önce fotoğraf çek', 'Kamera uygulamasıyla otelden bir kare yakala, sonra burada paylaş.', '📷 Kamerayı aç', () => this.phone.enterViewfinder()));
      return;
    }
    const d = this.draft;
    const pick = document.createElement('div');
    pick.className = 'ig-pick';
    const preview = document.createElement('img');
    preview.className = 'ig-preview';
    preview.alt = '';
    const place = document.createElement('small');
    place.className = 'ig-preview-place';
    const select = (photo) => {
      d.photoId = photo.id;
      preview.src = photo.url;
      place.textContent = `📍 ${this.phone.labelFor(photo.area)}`;
      for (const b of pick.children) b.classList.toggle('on', b.dataset.id === photo.id);
    };
    for (const photo of gallery) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ig-thumb';
      b.dataset.id = photo.id;
      const img = document.createElement('img');
      img.alt = '';
      img.src = photo.url;
      b.append(img);
      b.addEventListener('click', () => select(photo));
      pick.append(b);
    }
    const cur = gallery.find((p) => p.id === d.photoId) ?? gallery[0];

    const ta = document.createElement('textarea');
    ta.className = 'ig-text';
    ta.maxLength = INSTA.CAPTION_MAX;
    ta.rows = 3;
    ta.placeholder = 'Açıklama yaz… (ör. Kanal manzaralı odalarımız sizi bekliyor 🌷)';
    ta.value = d.caption;
    const counter = document.createElement('small');
    counter.className = 'ig-counter';
    const upd = () => { counter.textContent = `${ta.value.length}/${INSTA.CAPTION_MAX}`; };
    ta.addEventListener('input', () => {
      d.caption = ta.value;
      upd();
    });
    upd();

    const budgets = document.createElement('div');
    budgets.className = 'ig-budgets';
    budgets.setAttribute('role', 'radiogroup');
    const money = this.state.economy?.money ?? 0;
    const rush = this.rushActive;
    const msg = document.createElement('p');
    msg.className = 'ig-msg';
    for (const tier of AD_BUDGETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ig-budget';
      b.setAttribute('role', 'radio');
      const t = document.createElement('b');
      t.textContent = tier.budget ? `${formatMoney(tier.budget)} · ${tier.name}` : 'Organik · €0';
      const h = document.createElement('small');
      let why = '';
      if (tier.budget > money) why = ' — kasada yetersiz';
      else if (tier.boost && rush) why = ' — kampanya zaten sürüyor';
      h.textContent = `${BUDGET_HINT[tier.budget]}${why}`;
      b.append(t, h);
      b.disabled = !!why;
      if (b.disabled && d.budget === tier.budget) d.budget = 0;
      b.addEventListener('click', () => {
        d.budget = tier.budget;
        for (const x of budgets.children) x.setAttribute('aria-checked', String(x === b));
      });
      b.setAttribute('aria-checked', String(d.budget === tier.budget));
      budgets.append(b);
    }
    const kasa = document.createElement('small');
    kasa.className = 'ig-kasa';
    kasa.textContent = `🏦 Otel kasası: ${formatMoney(money)} · bütçe kasadan ödenir`;

    const share = button('Paylaş', 'primary ig-share', () => this.submit(share, msg));
    body.append(preview, place, pick, ta, counter, budgets, kasa, msg, share);
    select(cur);
  }

  async submit(btn, msg) {
    const d = this.draft;
    const photo = this.phone.gallery.find((p) => p.id === d.photoId);
    if (!photo) {
      msg.textContent = 'Bir fotoğraf seç.';
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Paylaşılıyor…';
    this.selfPosted = true;
    const res = await this.net.request(EVT.INSTA_ACT, {
      act: 'post', photo: photo.url, caption: d.caption, budget: d.budget, place: photo.area ?? null,
    }, 10_000);
    btn.disabled = false;
    if (!res.ok) {
      this.selfPosted = false;
      msg.textContent = res.error || 'Paylaşılamadı.';
      return;
    }
    this.hud.toast(d.budget ? `📸 Kampanya yayında! ${formatMoney(d.budget)} kasadan ödendi.` : '📸 Gönderi paylaşıldı!', 'money');
    this.draft = { photoId: null, caption: '', budget: 0 };
    this.view = 'feed';
    this.phone.rerender();
  }
}
