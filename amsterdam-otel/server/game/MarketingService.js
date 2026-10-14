import { EVT, formatMoney, possessive } from '../../shared/constants.js';
import {
  INSTA, budgetTier, starMultiplier, isPhotoDataUrl, cleanCaption, isPlaceId, placeLabel, formatCount,
} from '../../shared/marketing.js';

const BOOST_SOURCE = 'insta';
const JPEG_SIG = 'data:image/jpeg;base64,/9j/'; // FF D8 FF: JPEG dosya imzası (base64)
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

const randInt = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * InstaHotel: otelin sosyal medya hesabı (@hotel.amsterdam) ve reklam kampanyaları.
 *
 *  - Gönderi ('post'): oyuncunun telefonla çektiği JPEG (katı data URL doğrulaması, ≤ ~90 KB) +
 *    açıklama (sohbetle aynı temizlik, ≤ 200) + bütçe (Organik €0 / €50 / €150 / €300, OTEL KASASINDAN).
 *    Oyuncu başına 20 sn'de bir gönderi; aynı anda otel genelinde TEK ücretli kampanya (süren kampanya
 *    bitmeden yenisi açılamaz — organik gönderi her zaman serbest).
 *  - Ücretli kampanya 1 oyun günü (clock.total + 1440) sürer: BoostService'e 'insta' kaynağıyla misafir /
 *    bar sıklığı ve bahşiş çarpanları eklenir; GuestManager bu sırada misafirleri kafileler hâlinde getirir
 *    (rushActive) ve resepsiyonda kuyruk oluşur.
 *  - Beğeni / takipçi artışı sunucudadır: gönderi anında bütçeye ve yıldıza göre (sim.rng) bir hedef
 *    belirlenir, GROWTH_STEP_MS'de bir (simülasyon tick'inde; ayrı zamanlayıcı yok) parça parça eklenir.
 *    Yayın yalnızca sayaçlardır (EVT.INSTA_STATS: { f, p: [[id, likes]] }); istemci sayaçları canlandırır.
 *  - Oyuncu beğenisi: gönderi başına oyuncu (kalıcı anahtar özeti) başına bir kez.
 *  - Bellekte son 20 gönderi; kalıcı kayda (hotelState.insta) takipçi + son 6 gönderi (fotoğrafların
 *    toplamı ~400 KB ile sınırlı; sığmayan eskilerin fotoğrafı düşer). Süren artışlar kaydedilmez.
 *  - Ağ / pil: WELCOME'da yalnızca en yeni 4 gönderinin fotoğrafı gelir (≤ ~360 KB); diğerleri telefon
 *    akışında göründükçe tek tek istenir ('photo'). Yeni gönderi bir kez, fotoğrafıyla herkese yayınlanır.
 */
export class MarketingService {
  constructor(sim) {
    this.sim = sim;
    this.followers = 0;
    this.posts = []; // en yeni sonda
    this.nextId = 1;
    this.lastPostAt = new Map(); // oyuncu anahtarı → son gönderi zamanı (gerçek ms)
    this.nextStepAt = 0;
    this.followerMilestone = 0; // ulaşılan son takipçi eşiği
  }

  get rng() { return this.sim.rng; }

  /** Turist akını sürüyor mu (ücretli kampanya) */
  get rushActive() { return this.sim.boosts.has(BOOST_SOURCE); }

  get rushUntil() {
    return this.sim.boosts.list.find((b) => b.source === BOOST_SOURCE)?.untilTotal ?? null;
  }

  /** Oyuncunun beğeni / hız sınırı anahtarı: kalıcı anahtar özeti, yoksa oturum kimliği */
  playerKey(p) { return p.keyHash ?? `id:${p.id}`; }

  // ---- Ağ biçimleri ----------------------------------------------------------------

  wire(post, withPhoto) {
    const w = {
      id: post.id, by: post.by, color: post.color, caption: post.caption, place: post.place,
      budget: post.budget, likes: post.likes, t: post.t,
    };
    if (withPhoto && post.photo) w.photo = post.photo;
    if (!post.photo) w.noPhoto = true;
    return w;
  }

  /** WELCOME snapshot.insta (en yeni önce; fotoğraf yalnızca en yeni SNAPSHOT_PHOTOS gönderide) */
  serialize(p = null) {
    const list = this.posts.slice().reverse();
    const key = p ? this.playerKey(p) : null;
    return {
      account: INSTA.ACCOUNT,
      followers: this.followers,
      posts: list.map((post, i) => this.wire(post, i < INSTA.SNAPSHOT_PHOTOS)),
      liked: key ? list.filter((post) => post.likers.has(key)).map((post) => post.id) : [],
      rushUntil: this.rushUntil,
    };
  }

  stats(posts) {
    return { f: this.followers, p: posts.map((post) => [post.id, post.likes]) };
  }

  // ---- İstemci eylemleri -------------------------------------------------------------

  act(p, data, now) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Geçersiz istek.' };
    switch (data.act) {
      case 'post': return this.post(p, data, now);
      case 'like': return this.like(p, data.id);
      case 'feed': return { ok: true, ...this.serialize(p) };
      case 'photo': return this.photo(data.id);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  post(p, data, now) {
    const { photo, caption: rawCaption, budget, place } = data;
    if (!isPhotoDataUrl(photo) || !photo.startsWith(JPEG_SIG)) {
      return { ok: false, error: 'Fotoğraf geçersiz ya da çok büyük (yalnızca telefonla çekilen JPEG, en fazla ~90 KB).' };
    }
    const caption = cleanCaption(rawCaption);
    if (caption === null) return { ok: false, error: 'Açıklama geçersiz.' };
    const tier = budgetTier(budget);
    if (!tier) return { ok: false, error: 'Geçersiz reklam bütçesi.' };
    if (place !== undefined && place !== null && !isPlaceId(place)) return { ok: false, error: 'Geçersiz konum.' };

    const key = this.playerKey(p);
    const last = this.lastPostAt.get(key);
    if (last !== undefined && now - last < INSTA.POST_COOLDOWN_MS) {
      const sec = Math.ceil((INSTA.POST_COOLDOWN_MS - (now - last)) / 1000);
      return { ok: false, error: `Biraz bekle — ${sec} sn sonra yeni gönderi paylaşabilirsin.` };
    }
    if (tier.boost && this.rushActive) {
      return { ok: false, error: 'Zaten süren bir reklam kampanyası var — bitince yenisini başlatabilirsin. (Organik gönderi serbest.)' };
    }
    if (tier.budget > 0 && this.sim.money < tier.budget) {
      return { ok: false, error: `Kasada yeterli para yok: ${formatMoney(tier.budget)} gerekli.` };
    }

    if (tier.budget > 0) this.sim.spend(tier.budget, `📸 InstaHotel reklamı (${tier.name})`);
    this.lastPostAt.set(key, now);

    // Etkileşim hedefi: bütçe aralığı × yıldız çarpanı (+ mevcut takipçilerin küçük katkısı)
    const mult = starMultiplier(this.sim.growth.stars);
    const likes = Math.round(randInt(this.rng, tier.likes) * mult + this.followers * 0.04);
    const followers = Math.round(randInt(this.rng, tier.followers) * mult);
    const steps = Math.max(1, Math.round(tier.growMs / INSTA.GROWTH_STEP_MS));
    const ownHouse = typeof place === 'string' && this.sim.house.houseIdOf?.(p) === place;
    const post = {
      id: this.nextId++,
      by: p.name,
      color: p.color,
      authorKey: key,
      photo,
      caption,
      place: placeLabel(place, { houseName: ownHouse ? `${possessive(p.name)} evi` : null }),
      budget: tier.budget,
      likes: 0,
      t: now,
      likers: new Set(),
      milestone: 0, // ulaşılan son beğeni eşiği
      grow: { likes, followers, steps },
    };
    this.posts.push(post);
    while (this.posts.length > INSTA.FEED_MAX) this.posts.shift();
    if (!this.nextStepAt || this.nextStepAt < now) this.nextStepAt = now + INSTA.GROWTH_STEP_MS;

    this.sim.out(EVT.INSTA_FEED, { post: this.wire(post, true), followers: this.followers });
    if (tier.boost) this.startCampaign(tier, p);
    else this.sim.notify(`📸 ${p.name} InstaHotel'de yeni bir gönderi paylaştı.`, 'info');
    this.sim.house.scheduleSave();
    return { ok: true, id: post.id };
  }

  startCampaign(tier, p) {
    const b = tier.boost;
    this.sim.boosts.add({
      source: BOOST_SOURCE,
      label: 'InstaHotel kampanyası — turist akını',
      icon: '📸',
      minutes: INSTA.CAMPAIGN_MINUTES,
      guestSpawn: b.guestSpawn,
      barSpawn: b.barSpawn,
      barTip: b.barTip,
    });
    const weekend = this.sim.clock.weekend ? ' (Hafta sonu otel kapalı: kafileler pazartesi gelir, bar hemen dolar.)' : '';
    this.sim.notify(`📸 ${p.name} ${formatMoney(tier.budget)} bütçeli "${tier.name}" başlattı! 1 gün boyunca turist akını — resepsiyonda kuyruk olabilir.${weekend}`, 'day');
  }

  like(p, id) {
    if (!Number.isInteger(id)) return { ok: false, error: 'Geçersiz gönderi.' };
    const post = this.posts.find((x) => x.id === id);
    if (!post) return { ok: false, error: 'Gönderi bulunamadı.' };
    const key = this.playerKey(p);
    if (post.likers.has(key)) return { ok: false, error: 'Bu gönderiyi zaten beğendin.' };
    post.likers.add(key);
    post.likes += 1;
    this.sim.out(EVT.INSTA_STATS, this.stats([post]));
    this.checkLikeMilestone(post);
    this.sim.house.scheduleSave();
    return { ok: true, likes: post.likes };
  }

  photo(id) {
    if (!Number.isInteger(id)) return { ok: false, error: 'Geçersiz gönderi.' };
    const post = this.posts.find((x) => x.id === id);
    if (!post) return { ok: false, error: 'Gönderi bulunamadı.' };
    if (!post.photo) return { ok: false, error: 'Bu gönderinin fotoğrafı arşivde yok.' };
    return { ok: true, id, photo: post.photo };
  }

  // ---- Zamanla artış (HotelSimulation.tick) -------------------------------------------

  update(now) {
    if (!this.nextStepAt || now < this.nextStepAt) return;
    const changed = [];
    const followersBefore = this.followers;
    for (const post of this.posts) {
      const g = post.grow;
      if (!g) continue;
      // Bu adımın payı: kalan / kalan adım × (0.5–1.5) — son adım kalanın hepsi
      const share = g.steps <= 1 ? 1 : Math.min(1, (0.5 + this.rng()) / g.steps);
      const dl = Math.round(g.likes * share);
      const df = Math.round(g.followers * share);
      g.likes -= dl;
      g.followers -= df;
      g.steps -= 1;
      post.likes += dl;
      this.followers += df;
      if (g.steps <= 0) {
        post.likes += g.likes;
        this.followers += g.followers;
        post.grow = null;
      }
      if (dl || !post.grow) changed.push(post);
    }
    this.nextStepAt = this.posts.some((x) => x.grow) ? now + INSTA.GROWTH_STEP_MS : 0;
    if (!changed.length && followersBefore === this.followers) return;
    this.sim.out(EVT.INSTA_STATS, this.stats(changed));
    for (const post of changed) this.checkLikeMilestone(post);
    this.checkFollowerMilestone();
    this.sim.house.scheduleSave();
  }

  checkLikeMilestone(post) {
    let m = post.milestone;
    for (const v of INSTA.LIKE_MILESTONES) if (post.likes >= v) m = Math.max(m, v);
    if (m === post.milestone) return;
    post.milestone = m;
    const author = [...this.sim.players.values()].find((p) => this.playerKey(p) === post.authorKey);
    if (author) this.sim.toPlayer(author.id, EVT.NOTIFY, { text: `📸 Gönderin ${formatCount(m)} beğeniye ulaştı!`, kind: 'money' });
  }

  checkFollowerMilestone() {
    let m = this.followerMilestone;
    for (const v of INSTA.FOLLOWER_MILESTONES) if (this.followers >= v) m = Math.max(m, v);
    if (m === this.followerMilestone) return;
    this.followerMilestone = m;
    this.sim.notify(`📈 ${INSTA.ACCOUNT} ${formatCount(m)} takipçiye ulaştı!`, 'day');
  }

  // ---- Kalıcılık ---------------------------------------------------------------------

  persisted() {
    const posts = [];
    let bytes = 0;
    for (const post of this.posts.slice(-INSTA.PERSIST_POSTS).reverse()) {
      const fits = post.photo && bytes + post.photo.length <= INSTA.PERSIST_PHOTO_BYTES;
      if (fits) bytes += post.photo.length;
      posts.unshift({
        id: post.id, by: post.by, color: post.color, caption: post.caption, place: post.place, budget: post.budget,
        likes: post.likes + (post.grow?.likes ?? 0), t: post.t,
        photo: fits ? post.photo : null,
        likers: [...post.likers].filter((k) => HASH_RE.test(k)).slice(0, INSTA.MAX_LIKERS),
      });
    }
    return {
      followers: this.followers + this.posts.reduce((s, x) => s + (x.grow?.followers ?? 0), 0),
      nextId: this.nextId,
      posts,
    };
  }

  /** Bozuk / eksik kayıt sessizce yok sayılır (alan alan doğrulanır) */
  restore(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    if (Number.isInteger(d.followers) && d.followers >= 0 && d.followers <= 1e9) this.followers = d.followers;
    let maxId = 0;
    if (Array.isArray(d.posts)) {
      for (const raw of d.posts.slice(-INSTA.PERSIST_POSTS)) {
        const post = restorePost(raw);
        if (!post || this.posts.some((x) => x.id === post.id)) continue;
        this.posts.push(post);
        maxId = Math.max(maxId, post.id);
      }
      this.posts.sort((a, b) => a.id - b.id);
    }
    this.nextId = Number.isInteger(d.nextId) && d.nextId > maxId && d.nextId < 1e9 ? d.nextId : maxId + 1;
    for (const v of INSTA.FOLLOWER_MILESTONES) if (this.followers >= v) this.followerMilestone = v;
  }
}

function restorePost(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Number.isInteger(raw.id) || raw.id < 1 || raw.id >= 1e9) return null;
  const caption = cleanCaption(raw.caption);
  const tier = budgetTier(raw.budget);
  if (caption === null || !tier) return null;
  const by = cleanCaption(raw.by);
  const place = cleanCaption(raw.place);
  const photo = isPhotoDataUrl(raw.photo) && raw.photo.startsWith(JPEG_SIG) ? raw.photo : null;
  const likers = new Set(Array.isArray(raw.likers) ? raw.likers.filter((k) => typeof k === 'string' && HASH_RE.test(k)).slice(0, INSTA.MAX_LIKERS) : []);
  const likes = Number.isInteger(raw.likes) && raw.likes >= 0 && raw.likes < 1e9 ? raw.likes : likers.size;
  const post = {
    id: raw.id,
    by: by ? by.slice(0, 16) : 'Görevli',
    color: typeof raw.color === 'string' && COLOR_RE.test(raw.color) ? raw.color : '#ff7a1a',
    authorKey: null,
    photo,
    caption,
    place: place ? place.slice(0, 40) : 'Amsterdam',
    budget: tier.budget,
    likes,
    t: Number.isFinite(raw.t) ? raw.t : 0,
    likers,
    milestone: 0,
    grow: null,
  };
  for (const v of INSTA.LIKE_MILESTONES) if (likes >= v) post.milestone = v;
  return post;
}
