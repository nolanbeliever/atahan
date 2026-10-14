/* =====================================================
   FizikLab 9 – 9. sınıf fizik oyunları
   Bölümler:
   0) Yardımcılar, depolama, tema, yönlendirme
   1) Oyun 1 – Özkütle & Sıvı Kulesi
   2) Oyun 2 – Sürtünme & İvme Parkuru (Canvas)
   3) Oyun 3 – Enerji Dönüşüm Hız Treni (Canvas)
   4) Quiz + Skor Tablosu
   5) Başlatma
   ===================================================== */
'use strict';

/* ---------- 0) Yardımcılar ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const G = 10; // yerçekimi ivmesi (MEB müfredatında 10 m/s²)
const fmt = (n, d = 1) => Number(n).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtD = (n) => Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type = '') {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

function celebrate() {
  const colors = ['#a78bfa', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
    c.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    c.style.animationDuration = (1.6 + Math.random() * 1.4) + 's';
    c.style.animationDelay = Math.random() * 0.3 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
}

/* Canvas'ın okuyacağı tema renkleri (CSS değişkenlerinden) */
const C = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  C.bg = v('--canvas-bg'); C.text = v('--text'); C.muted = v('--muted'); C.border = v('--border');
  C.accent = v('--accent'); C.accent2 = v('--accent-2'); C.good = v('--good'); C.bad = v('--bad'); C.warn = v('--warn');
  C.dark = document.documentElement.dataset.theme === 'dark';
}

/* ---------- Depolama (Local Storage) ---------- */
const Store = {
  KEY: 'fizikLab.v1',
  data: null,
  defaults() {
    return {
      xp: 0,
      density: {},                                   // { 0: {score, stars}, ... }
      friction: { wins: 0, best: 0, streak: 0 },
      coaster: { wins: 0, best: 0, tries: 0 },
      quiz: { high: 0, board: [] },
    };
  },
  load() {
    const d = this.defaults();
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (raw && typeof raw === 'object') {
        for (const k of Object.keys(d)) {
          if (raw[k] === undefined) continue;
          d[k] = (typeof d[k] === 'object' && !Array.isArray(d[k])) ? Object.assign(d[k], raw[k]) : raw[k];
        }
      }
    } catch (e) { /* bozuk veri → varsayılan */ }
    this.data = d;
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* özel mod */ } },
  addXP(n) { if (n > 0) { this.data.xp += Math.round(n); this.save(); UI.refresh(); } },
  reset() { this.data = this.defaults(); this.save(); UI.refresh(); },
};

const UI = {
  totalStars() { return Object.values(Store.data.density).reduce((a, l) => a + (l.stars || 0), 0); },
  refresh() {
    const d = Store.data;
    $('#xp-badge').textContent = '⭐ ' + d.xp + ' XP';
    $('#home-xp').textContent = d.xp;
    $('#home-stars').textContent = this.totalStars();
    $('#home-quiz').textContent = d.quiz.high;
  },
};

/* ---------- Tema ---------- */
const Theme = {
  init() {
    readColors();
    $('#theme-toggle').addEventListener('click', () => this.apply(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  },
  apply(t) {
    const root = document.documentElement;
    root.dataset.theme = t;
    root.classList.toggle('dark', t === 'dark');
    try { localStorage.setItem('fizik-theme', t); } catch (e) { /* yoksay */ }
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#070b16' : '#eef2fb';
    readColors();
  },
};

/* ---------- Yönlendirme (hash tabanlı) ---------- */
const Router = {
  views: ['home', 'density', 'friction', 'coaster', 'quiz', 'scores'],
  modules: {},
  current: null,
  init() {
    window.addEventListener('hashchange', () => this.go());
    $('#menu-btn').addEventListener('click', () => {
      const nav = $('#main-nav');
      const open = nav.classList.toggle('open');
      $('#menu-btn').setAttribute('aria-expanded', open);
    });
    this.go();
  },
  go() {
    const [name0, param] = location.hash.replace(/^#\/?/, '').split('/');
    const name = this.views.includes(name0) ? name0 : 'home';
    if (this.current && this.modules[this.current] && this.modules[this.current].leave) this.modules[this.current].leave();
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    $$('#main-nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
    $('#main-nav').classList.remove('open');
    $('#menu-btn').setAttribute('aria-expanded', 'false');
    this.current = name;
    document.body.dataset.route = name;
    window.scrollTo(0, 0);
    if (this.modules[name] && this.modules[name].enter) this.modules[name].enter(param);
  },
};

/* =====================================================
   1) OYUN 1 – ÖZKÜTLE & SIVI KULESİ
   ===================================================== */
const Density = (() => {
  // m (g), V (cm³) değerleri d = m/V sonucunu verir
  const LIQ = {
    civa:     { id: 'civa',     name: 'Cıva',       d: 13.6, m: 680,  V: 50,  color: '#b8c2d3', emoji: '🪞' },
    gliserin: { id: 'gliserin', name: 'Gliserin',   d: 1.26, m: 126,  V: 100, color: '#34d399', emoji: '🧴' },
    su:       { id: 'su',       name: 'Su',         d: 1.0,  m: 75,   V: 75,  color: '#38bdf8', emoji: '💧' },
    yag:      { id: 'yag',      name: 'Zeytinyağı', d: 0.92, m: 92,   V: 100, color: '#facc15', emoji: '🫒' },
    alkol:    { id: 'alkol',    name: 'Alkol',      d: 0.79, m: 39.5, V: 50,  color: '#f472b6', emoji: '🧪' },
  };
  const OBJ = [
    { id: 'ahsap',     name: 'Ahşap',     d: 0.6,  m: 30,  V: 50, color: '#a16207', emoji: '🪵' },
    { id: 'buz',       name: 'Buz',       d: 0.9,  m: 45,  V: 50, color: '#7dd3fc', emoji: '🧊' },
    { id: 'plastik',   name: 'Plastik',   d: 1.1,  m: 55,  V: 50, color: '#fb923c', emoji: '🧸' },
    { id: 'aluminyum', name: 'Alüminyum', d: 2.7,  m: 135, V: 50, color: '#cbd5e1', emoji: '🥫' },
    { id: 'altin',     name: 'Altın',     d: 19.3, m: 965, V: 50, color: '#fbbf24', emoji: '🪙' },
  ];
  const ALL = Object.assign({}, LIQ, Object.fromEntries(OBJ.map((o) => [o.id, o])));
  const LEVELS = [
    { type: 'liq', title: 'Seviye 1', sub: 'Üç Sıvı', ids: ['su', 'yag', 'gliserin'] },
    { type: 'liq', title: 'Seviye 2', sub: 'Beş Sıvı', ids: ['civa', 'gliserin', 'su', 'yag', 'alkol'] },
    { type: 'obj', title: 'Seviye 3', sub: 'Cisimler', ids: ['civa', 'gliserin', 'su', 'yag', 'alkol'] },
  ];
  const CH = 360; // silindir iç yüksekliği (px)

  let level = 0, st = null, inited = false, suppressClick = false;

  const calcScore = () => Math.max(10, 100 - st.wrong * 10 - Object.keys(st.reveals).length * 5);
  const starOf = (sc) => (sc >= 80 ? 3 : sc >= 50 ? 2 : 1);

  function newState() {
    const L = LEVELS[level];
    const liqs = L.ids.map((id) => LIQ[id]).sort((a, b) => b.d - a.d); // dipten üste
    st = {
      liqs,
      items: shuffle(L.type === 'liq' ? liqs.slice() : OBJ.slice()),
      slots: new Array(liqs.length).fill(null), // sıvı seviyesi: slot -> id
      placed: {},                               // cisim seviyesi: id -> bölge
      wrong: 0, reveals: {}, selected: null, done: false,
    };
  }

  function setMsg(html, kind = 'info') {
    const el = $('#dn-msg');
    el.className = 'msg msg-' + kind + ' mt-4';
    el.innerHTML = html;
  }

  /* --- Çizim --- */
  function renderTabs() {
    $('#dn-tabs').innerHTML = LEVELS.map((L, i) => {
      const rec = Store.data.density[i];
      return `<button class="tab ${i === level ? 'active' : ''}" role="tab" aria-selected="${i === level}" data-level="${i}">${L.title} · ${L.sub}<span class="st">${stars(rec ? rec.stars : 0)}</span></button>`;
    }).join('');
  }

  function itemUsed(id) {
    return LEVELS[level].type === 'liq' ? st.slots.includes(id) : id in st.placed;
  }

  function renderTray() {
    $('#dn-tray').innerHTML = st.items.map((it) => {
      const shown = st.reveals[it.id];
      return `<div class="item-card ${itemUsed(it.id) ? 'used' : ''} ${st.selected === it.id ? 'selected' : ''}" data-id="${it.id}" style="--ic:${it.color}" tabindex="0" role="button" aria-label="${it.name} kartı">
        <div class="nm"><span class="sw"></span>${it.emoji} ${it.name}</div>
        <div class="kv">m = ${fmtD(it.m)} g</div>
        <div class="kv">V = ${fmtD(it.V)} cm³</div>
        <button class="calc ${shown ? 'shown' : ''}" data-calc="${it.id}" ${shown ? 'disabled' : ''}>${shown ? 'd = ' + fmtD(it.d) + ' g/cm³' : '🧮 d = ? (−5 puan)'}</button>
      </div>`;
    }).join('');
  }

  function renderCyl() {
    const L = LEVELS[level];
    const n = st.liqs.length, h = CH / n;
    let ticks = '';
    for (let p = 0; p <= 100; p += 10) {
      const big = p % 20 === 0;
      ticks += `<i class="${big ? 'big' : ''}" style="bottom:${(p / 100) * CH}px"></i>` + (big ? `<b style="bottom:${(p / 100) * CH}px">${p}</b>` : '');
    }
    let inner = '';
    const layerHtml = (liq, i, cls) =>
      `<div class="layer ${cls}" style="bottom:${i * h}px;height:${h}px;background:${liq.color}"><span>${liq.name} · d=${fmtD(liq.d)}</span></div>`;

    if (L.type === 'liq') {
      for (let i = 0; i < n; i++) {
        if (st.slots[i]) inner += layerHtml(LIQ[st.slots[i]], i, '');
        else inner += `<div class="drop" data-slot="${i}" tabindex="0" role="button" aria-label="${i + 1}. kat" style="bottom:${i * h}px;height:${h}px">${i + 1}. kat</div>`;
      }
    } else {
      st.liqs.forEach((liq, i) => { inner += layerHtml(liq, i, 'tower'); });
      const occupied = Object.values(st.placed);
      for (let z = 0; z <= n; z++) {
        if (occupied.includes(z)) continue;
        const b = clamp(z * h - 13, 0, CH - 26);
        inner += `<div class="drop zone" data-zone="${z}" tabindex="0" role="button" aria-label="${z}. sınır" style="bottom:${b}px">⬇ bırak</div>`;
      }
      for (const [id, z] of Object.entries(st.placed)) {
        const o = ALL[id];
        inner += `<div class="obj-ball" title="${o.name}" style="--c:${o.color};bottom:${clamp(z * h, 0, CH - 34)}px">${o.emoji}</div>`;
      }
    }
    $('#dn-cyl-wrap').innerHTML = `<div class="cyl-ticks">${ticks}</div><div class="cyl" id="dn-cyl">${inner}</div><div class="muted small" style="text-align:center;margin-top:6px">${L.type === 'liq' ? 'Alttan üste: 1. kat → ' + n + '. kat' : 'Cisim, kendinden yoğun ilk sıvının üstünde durur'}</div>`;
  }

  function renderStats() {
    const sc = calcScore();
    $('#dn-score').textContent = sc;
    $('#dn-wrong').textContent = st.wrong;
    $('#dn-stars').textContent = stars(st.done ? starOf(sc) : 0);
    $('#dn-next').classList.toggle('hidden', !(st.done && level < LEVELS.length - 1));
  }

  function renderAll() {
    renderTabs(); renderTray(); renderCyl(); renderStats();
  }

  function setLevel(i) {
    level = i;
    newState();
    renderAll();
    setMsg(LEVELS[level].type === 'liq'
      ? 'Sıvı kartını bir bölmeye bırak. İpucu: özkütlesi <b>en büyük</b> olan sıvı <b>en alta</b> gider.'
      : 'Kule hazır! Her cismi, <b>özkütlesine uygun sınıra</b> bırak: cisim, kendinden daha yoğun ilk sıvının üstünde durur.');
  }

  /* --- Yerleştirme mantığı --- */
  function place(id, targetEl) {
    if (st.done || !targetEl) return;
    const L = LEVELS[level];
    const it = ALL[id];
    const n = st.liqs.length;
    const k = st.liqs.filter((l) => l.d > it.d).length; // kendinden yoğun sıvı sayısı = doğru konum
    let ok = false;

    if (L.type === 'liq') {
      const s = +targetEl.dataset.slot;
      if (s === k) {
        ok = true;
        st.slots[s] = id;
        const above = n - 1 - k;
        const where = [k ? `${k} daha yoğun sıvının üstünde` : 'en dipte', above ? `${above} daha hafif sıvının altında` : 'en üstte'].join(' ve ');
        setMsg(`✔ <b>${it.name}</b> (d = ${fmtD(it.d)} g/cm³) doğru yerde! Kulede ${where} yer alır.`, 'ok');
      } else if (s > k) {
        st.wrong++;
        setMsg(k === 0
          ? `✖ <b>Çok yukarıda!</b> ${it.name} (d = ${fmtD(it.d)} g/cm³) bu kuledeki <b>en yoğun</b> sıvıdır. Daha yoğun sıvı batar; ondan yoğun sıvı olmadığı için en dibe çöker.`
          : `✖ <b>Çok yukarıda!</b> ${it.name}: d = ${fmtD(it.d)} g/cm³. Kuledeki <b>${k}</b> sıvının özkütlesi daha büyük; yoğun sıvılar daha aşağıya çöker ve ${it.name} onların üstünde kalır. Daha aşağı bir kat dene.`, 'bad');
      } else {
        st.wrong++;
        setMsg(`✖ <b>Çok aşağıda!</b> ${it.name} (d = ${fmtD(it.d)}) için <b>${k}</b> sıvı daha yoğun. Özkütlesi küçük olan sıvı, büyük olanın üstünde yüzer; bu yüzden ${it.name} daha yukarıya ait.`, 'bad');
      }
    } else {
      const z = +targetEl.dataset.zone;
      if (z === k) {
        ok = true;
        st.placed[id] = z;
        let why;
        if (z === 0) why = `hepsinden daha yoğun olduğu için <b>dibe çöker</b>.`;
        else if (z === n) why = `hiçbir sıvıdan yoğun olmadığı için <b>en üstte yüzer</b>.`;
        else why = `<b>${st.liqs[z].name}</b> (d = ${fmtD(st.liqs[z].d)}) sıvısından yoğun olduğu için batar, ama <b>${st.liqs[z - 1].name}</b> (d = ${fmtD(st.liqs[z - 1].d)}) sıvısından hafif olduğu için onun üstünde durur.`;
        setMsg(`✔ <b>${it.name}</b> (d = ${fmtD(it.d)}) ${why}`, 'ok');
      } else if (z < k) {
        st.wrong++;
        const liq = st.liqs[z];
        setMsg(`✖ ${it.name} (d = ${fmtD(it.d)}) &lt; <b>${liq.name}</b> (d = ${fmtD(liq.d)}): cismin özkütlesi bu sıvıdan küçük olduğu için orada batmaz, yukarı doğru yüzer. Daha yukarıdaki bir sınır dene.`, 'bad');
      } else {
        st.wrong++;
        const liq = st.liqs[z - 1];
        setMsg(`✖ ${it.name} (d = ${fmtD(it.d)}) &gt; <b>${liq.name}</b> (d = ${fmtD(liq.d)}): cismin özkütlesi bu sıvıdan büyük olduğu için içinde batmaya devam eder. Daha aşağıdaki bir sınır dene.`, 'bad');
      }
    }

    st.selected = null;
    if (!ok) {
      targetEl.classList.remove('shake'); void targetEl.offsetWidth; targetEl.classList.add('shake');
      renderStats(); renderTray();
      return;
    }
    const complete = L.type === 'liq' ? st.slots.every(Boolean) : Object.keys(st.placed).length === OBJ.length;
    renderAll();
    if (complete) finish();
  }

  function finish() {
    st.done = true;
    const sc = calcScore(), s = starOf(sc);
    const prev = Store.data.density[level];
    const prevScore = prev ? prev.score : 0;
    if (!prev || sc > prev.score) Store.data.density[level] = { score: sc, stars: s };
    Store.save();
    Store.addXP(Math.max(0, (sc - prevScore) / 2));
    renderAll();
    setMsg(`🎉 <b>Seviye tamam!</b> ${stars(s)} • ${sc} puan<br>Kural: <b>d büyük → alta, d küçük → üste.</b>${level < LEVELS.length - 1 ? ' Sonraki seviyeye geçebilirsin.' : ' Tüm seviyeleri bitirdin, harikasın!'}`, 'ok');
    celebrate();
  }

  /* --- Sürükle-bırak + dokun-seç --- */
  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('.drop') : null;
  }

  function bindDrag() {
    const tray = $('#dn-tray');
    tray.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.item-card');
      if (!card || e.target.closest('.calc') || card.classList.contains('used') || st.done) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const id = card.dataset.id;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null, moved = false, over = null;

      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          moved = true;
          ghost = card.cloneNode(true);
          ghost.classList.add('drag-ghost');
          ghost.classList.remove('selected');
          document.body.appendChild(ghost);
          card.classList.add('dragging');
          document.body.classList.add('is-dragging');
        }
        if (!moved) return;
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = ev.clientY + 'px';
        const t = targetAt(ev.clientX, ev.clientY);
        if (over && over !== t) over.classList.remove('over');
        if (t) t.classList.add('over');
        over = t;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (over) over.classList.remove('over');
        if (ghost) ghost.remove();
        card.classList.remove('dragging');
        document.body.classList.remove('is-dragging');
        if (moved) {
          suppressClick = true; setTimeout(() => { suppressClick = false; }, 80);
          if (ev.type === 'pointerup') place(id, targetAt(ev.clientX, ev.clientY));
        } else {
          st.selected = st.selected === id ? null : id;
          renderTray();
          if (st.selected) setMsg('Kart seçildi: şimdi silindirde bırakmak istediğin bölmeye dokun.', 'info');
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    tray.addEventListener('click', (e) => {
      const b = e.target.closest('.calc');
      if (!b || st.done) return;
      const id = b.dataset.calc;
      if (!st.reveals[id]) { st.reveals[id] = true; renderTray(); renderStats(); }
    });
    tray.addEventListener('keydown', (e) => {
      const card = e.target.closest('.item-card');
      if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        st.selected = st.selected === card.dataset.id ? null : card.dataset.id;
        renderTray();
        const again = $(`.item-card[data-id="${card.dataset.id}"]`); if (again) again.focus();
      }
    });

    const wrap = $('#dn-cyl-wrap');
    wrap.addEventListener('click', (e) => {
      const d = e.target.closest('.drop');
      if (!d || suppressClick) return;
      if (!st.selected) { setMsg('Önce tezgâhtan bir kart seç (dokun) ya da sürükleyip bırak.', 'info'); return; }
      place(st.selected, d);
    });
    wrap.addEventListener('keydown', (e) => {
      const d = e.target.closest('.drop');
      if (d && (e.key === 'Enter' || e.key === ' ') && st.selected) { e.preventDefault(); place(st.selected, d); }
    });
  }

  function init() {
    inited = true;
    bindDrag();
    $('#dn-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-level]');
      if (b) setLevel(+b.dataset.level);
    });
    $('#dn-reset').addEventListener('click', () => setLevel(level));
    $('#dn-next').addEventListener('click', () => setLevel(Math.min(level + 1, LEVELS.length - 1)));
    setLevel(0);
  }

  return {
    enter() { if (!inited) init(); else renderTabs(); },
    _debug: () => ({ st, level, LEVELS }),
  };
})();

/* =====================================================
   2) OYUN 2 – SÜRTÜNME & İVME SİMÜLASYON PARKURU
   ===================================================== */
const Friction = (() => {
  const SURF = {
    ice:      { name: 'Buz',   k: 0.05, range: [60, 160], width: 12, tip: 'Buzda k çok küçük: sürtünme az, blok uzağa kayar. Kuvveti erken kes!' },
    concrete: { name: 'Beton', k: 0.40, range: [22, 70],  width: 7,  tip: 'Betonda orta sürtünme: itmeyi bırakınca blok hızlıca yavaşlar.' },
    sand:     { name: 'Kum',   k: 0.65, range: [10, 35],  width: 5,  tip: 'Kumda sürtünme büyük: hareket için F > k·N olmalı, blok çabuk durur.' },
  };
  let W = 960, BX = 270;                                   // W: ekran genişliğine göre değişen sanal genişlik
  const H = 360, GROUND = 262, PPM = 14, DT = 1 / 120, WINDOW = 12;
  const cv = $('#fr-canvas'), ctx = cv.getContext('2d');
  const gv = $('#fr-graph'), gctx = gv.getContext('2d');

  let surf = 'concrete', mass = 10, forceSet = 60;
  let held = false, kb = false, lock = false;
  let s = null, active = false, inited = false, raf = 0, last = 0, acc = 0, frameNo = 0;

  function fit() {
    const cw = cv.clientWidth || 960;
    W = cw < 500 ? 440 : cw < 760 ? 600 : 960;
    BX = Math.round(W * 0.28);
    if (cv.width !== W) cv.width = W;
    const gw = (gv.clientWidth || 960) < 760 ? 560 : 960;
    if (gv.width !== gw) gv.width = gw;
  }
  const pushing = () => held || kb || lock;
  const kinForce = () => SURF[surf].k * mass * G;
  const blockSize = () => clamp(44 + mass * 2, 50, 84);

  function pickTarget() {
    const S = SURF[surf];
    const c = S.range[0] + Math.random() * (S.range[1] - S.range[0]);
    s.tgt = { c: Math.round(c), w: S.width };
  }

  function resetBlock(newTarget) {
    const prevTgt = s ? s.tgt : null;
    s = { x: 0, v: 0, a: 0, F: 0, Fs: 0, t: 0, phase: 'ready', hist: [], histT: 0, parts: [], tgt: prevTgt, result: null };
    if (newTarget || !prevTgt) pickTarget();
    setMsg(`🎯 Hedef bölge: <b>${fmt(s.tgt.c - s.tgt.w / 2, 1)} – ${fmt(s.tgt.c + s.tgt.w / 2, 1)} m</b>. ${SURF[surf].tip}`, 'info');
    refreshFormula();
  }

  function setMsg(html, kind = 'info') {
    const el = $('#fr-msg');
    el.className = 'msg msg-' + kind + ' mt-4';
    el.innerHTML = html;
  }

  function refreshFormula() {
    const N = mass * G, kin = kinForce();
    const k = SURF[surf].k;
    const hold = forceSet <= kin
      ? ` <br><span style="color:var(--bad)">F (${forceSet}) ≤ Fs (${fmt(kin, 0)}) → blok kıpırdamaz</span>`
      : ` <br><span style="color:var(--good)">a = (F − Fs)/m = ${fmt((forceSet - kin) / mass, 2)} m/s²</span>`;
    $('#fr-formula').innerHTML = `N = m·g = ${mass}×10 = ${N} N<br>Fs = k·N = ${fmt(k, 2)} × ${N} = ${fmt(kin, 1)} N${hold}`;
  }

  /* --- Fizik adımı --- */
  function step(dt) {
    const F = pushing() ? forceSet : 0;
    const kin = kinForce();
    let Fs, a;
    if (s.v <= 0.0005) {                      // durgun: statik durum
      if (F <= kin) { s.v = 0; Fs = F; a = 0; }
      else { Fs = kin; a = (F - kin) / mass; s.v += a * dt; }
    } else {                                   // hareketli: kinetik sürtünme
      Fs = kin; a = (F - Fs) / mass;
      let nv = s.v + a * dt;
      if (nv <= 0) { nv = 0; Fs = Math.min(F, kin); a = 0; }
      s.v = nv;
    }
    s.x += s.v * dt;
    s.F = F; s.Fs = Fs; s.a = a; s.t += dt;

    if (s.phase === 'ready' && s.v > 0.02) s.phase = 'moving';
    else if (s.phase === 'moving' && s.v === 0) evaluate();

    s.histT += dt;
    if (s.histT >= 0.05) {
      s.histT = 0;
      s.hist.push({ t: s.t, F, Fs, v: s.v, a });
      while (s.hist.length && s.hist[0].t < s.t - WINDOW - 1) s.hist.shift();
    }
  }

  function evaluate() {
    s.phase = 'result';
    const { c, w } = s.tgt;
    const err = s.x - c;
    const D = Store.data.friction;
    if (Math.abs(err) <= w / 2) {
      const sc = Math.round(50 + 50 * (1 - Math.abs(err) / (w / 2)));
      D.wins++; D.streak++; D.best = Math.max(D.best, sc);
      Store.save(); Store.addXP(sc / 5);
      s.result = 'win';
      setMsg(`🎉 <b>Hedefte durdu!</b> x = ${fmt(s.x, 1)} m • ${sc} puan. Fs = k·N olduğu için durma mesafesi k ve v ile belirlenir. “Yeni Hedef” ile devam et.`, 'ok');
      celebrate();
    } else {
      D.streak = 0; Store.save();
      s.result = 'lose';
      const miss = Math.abs(err) - w / 2;
      setMsg(err < 0
        ? `😕 Kısa kaldı: hedef bölgeye <b>${fmt(miss, 1)} m</b> var. Daha uzun it ya da daha fazla kuvvet uygula.`
        : `😕 Hedefi <b>${fmt(miss, 1)} m</b> geçtin. İtmeyi daha erken bırak: ${SURF[surf].tip}`, 'bad');
    }
    updateStats();
  }

  function updateStats() {
    const D = Store.data.friction;
    $('#fr-wins').textContent = D.wins; $('#fr-streak').textContent = D.streak; $('#fr-best').textContent = D.best;
  }

  function updateHud() {
    $('#fr-v').textContent = fmt(s.v, 2);
    $('#fr-a').textContent = fmt(s.a, 2);
    $('#fr-F').textContent = fmt(s.F, 0);
    $('#fr-fs').textContent = fmt(s.Fs, 1);
    $('#fr-net').textContent = fmt(s.F - s.Fs, 1);
    $('#fr-x').textContent = fmt(s.x, 1);
  }

  /* --- Çizim: sahne --- */
  const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const sx = (xm) => BX + (xm - s.x) * PPM;

  function arrow(c, x1, y1, x2, y2, color, lw = 4) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 3) return;
    const ux = dx / len, uy = dy / len, hl = Math.min(12, len * 0.5);
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = lw; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2 - ux * hl, y2 - uy * hl); c.stroke();
    c.beginPath(); c.moveTo(x2, y2);
    c.lineTo(x2 - ux * hl - uy * hl * 0.6, y2 - uy * hl + ux * hl * 0.6);
    c.lineTo(x2 - ux * hl + uy * hl * 0.6, y2 - uy * hl - ux * hl * 0.6);
    c.closePath(); c.fill();
  }

  function drawScene() {
    const c = ctx;
    // gökyüzü
    const sky = c.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, C.dark ? '#0b1130' : '#dbeafe');
    sky.addColorStop(1, C.dark ? '#1b1450' : '#f5f3ff');
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    // paralaks tepeler
    c.fillStyle = C.dark ? 'rgba(124,58,237,0.18)' : 'rgba(124,58,237,0.12)';
    c.beginPath(); c.moveTo(0, GROUND);
    for (let px = 0; px <= W; px += 20) {
      const wx = px + s.x * PPM * 0.25;
      c.lineTo(px, GROUND - 40 - 30 * Math.sin(wx / 90) - 18 * Math.sin(wx / 37));
    }
    c.lineTo(W, GROUND); c.fill();
    // yıldız/ışık noktaları (koyu temada)
    if (C.dark) {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 40; i++) c.fillRect(((rnd(i) * W * 2 - s.x * PPM * 0.08) % W + W) % W, rnd(i + 99) * (GROUND - 90), 2, 2);
    }

    // zemin
    const SF = surf;
    const g = c.createLinearGradient(0, GROUND, 0, H);
    if (SF === 'ice') { g.addColorStop(0, '#bff1ff'); g.addColorStop(1, '#6cc6ea'); }
    else if (SF === 'sand') { g.addColorStop(0, '#f1d58a'); g.addColorStop(1, '#c79a4a'); }
    else { g.addColorStop(0, '#8d97a8'); g.addColorStop(1, '#5b6475'); }
    c.fillStyle = g; c.fillRect(0, GROUND, W, H - GROUND);
    const x0 = Math.floor((s.x - BX / PPM) / 2) * 2, x1 = s.x + (W - BX) / PPM + 2;
    if (SF === 'ice') {
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2;
      for (let m = x0; m < x1; m += 4) { const px = sx(m); c.beginPath(); c.moveTo(px, GROUND + 6); c.lineTo(px + 26, GROUND + 14); c.stroke(); }
    } else if (SF === 'sand') {
      c.fillStyle = 'rgba(120,80,20,0.45)';
      for (let m = Math.floor(x0 * 2); m < x1 * 2; m++) c.fillRect(sx(m / 2), GROUND + 6 + rnd(m) * (H - GROUND - 10), 2.5, 2.5);
    } else {
      c.strokeStyle = 'rgba(20,25,40,0.45)'; c.lineWidth = 2;
      for (let m = Math.floor(x0 / 3) * 3; m < x1; m += 3) { const px = sx(m); c.beginPath(); c.moveTo(px, GROUND); c.lineTo(px, H); c.stroke(); }
    }
    c.fillStyle = C.dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.2)';
    c.fillRect(0, GROUND - 2, W, 3);

    // metre işaretleri
    c.font = '600 12px Inter, sans-serif'; c.textAlign = 'center';
    for (let m = Math.ceil(x0 / 5) * 5; m < x1; m += 5) {
      const px = sx(m), big = m % 10 === 0;
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(px - 1, GROUND, 2, big ? 14 : 8);
      if (big) { c.fillStyle = 'rgba(0,0,0,0.65)'; c.fillText(m + ' m', px, GROUND + 28); }
    }

    // hedef bölgesi
    const tl = sx(s.tgt.c - s.tgt.w / 2), tr = sx(s.tgt.c + s.tgt.w / 2);
    if (tr > -20 && tl < W + 20) {
      c.fillStyle = 'rgba(52,211,153,0.35)'; c.fillRect(tl, GROUND - 5, tr - tl, 22);
      c.strokeStyle = '#10b981'; c.lineWidth = 3; c.setLineDash([6, 4]);
      c.strokeRect(tl, GROUND - 5, tr - tl, 22); c.setLineDash([]);
      for (const px of [tl, tr]) {
        c.fillStyle = '#10b981'; c.fillRect(px - 1.5, GROUND - 64, 3, 60);
        c.beginPath(); c.moveTo(px + 1.5, GROUND - 64); c.lineTo(px + 24, GROUND - 54); c.lineTo(px + 1.5, GROUND - 44); c.fill();
      }
      c.fillStyle = C.dark ? '#6ee7b7' : '#047857'; c.font = '700 13px Outfit, sans-serif';
      c.fillText('🎯 HEDEF', (tl + tr) / 2, GROUND - 74);
    } else if (tl >= W) {
      c.textAlign = 'right'; c.fillStyle = C.dark ? '#6ee7b7' : '#047857'; c.font = '700 14px Outfit, sans-serif';
      c.fillText(`🎯 Hedef ${fmt(s.tgt.c - s.x, 0)} m ileride ➜`, W - 14, 62);
    }
    // başlangıç çizgisi
    const stx = sx(0);
    if (stx > -30 && stx < W + 30) {
      c.fillStyle = C.dark ? '#fff' : '#111'; c.fillRect(stx - 1, GROUND - 36, 3, 36);
      c.textAlign = 'left'; c.font = '700 12px Outfit, sans-serif'; c.fillText('BAŞLA', stx + 6, GROUND - 28);
    }

    // parçacıklar
    for (const p of s.parts) {
      c.globalAlpha = clamp(p.life * 2, 0, 1);
      c.fillStyle = p.color; c.fillRect(p.x, p.y, p.r, p.r);
    }
    c.globalAlpha = 1;

    // blok
    const size = blockSize(), bx0 = BX - size / 2, by0 = GROUND - size;
    c.save();
    c.shadowColor = 'rgba(124,58,237,0.7)'; c.shadowBlur = 18;
    const bg = c.createLinearGradient(bx0, by0, bx0 + size, GROUND);
    bg.addColorStop(0, '#8b5cf6'); bg.addColorStop(1, '#06b6d4');
    c.fillStyle = bg; c.beginPath(); c.roundRect(bx0, by0, size, size, 9); c.fill();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.roundRect(bx0 + 5, by0 + 5, size - 10, 10, 5); c.fill();
    c.fillStyle = '#fff'; c.font = '800 15px Outfit, sans-serif'; c.textAlign = 'center';
    c.fillText(mass + ' kg', BX, by0 + size / 2 + 6);
    if (s.v > 1) { // hız çizgileri
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const yy = by0 + 12 + i * (size - 24) / 2, len = clamp(s.v * 3, 8, 60); c.beginPath(); c.moveTo(bx0 - 8, yy); c.lineTo(bx0 - 8 - len, yy); c.stroke(); }
    }
    // iten el
    if (pushing()) { c.font = '26px serif'; c.textAlign = 'right'; c.fillText('👉', bx0 - 2 + Math.sin(s.t * 30) * 2, by0 + size / 2 + 9); }

    // kuvvet okları
    const ay = by0 - 26;
    const ak = W < 600 ? 0.6 : 1.1, lim = W * 0.18;
    const Lf = Math.min(s.F * ak, lim), Ls = Math.min(s.Fs * ak, lim);
    arrow(c, BX, ay, BX + Lf, ay, '#10b981', 6);
    arrow(c, BX, ay, BX - Ls, ay, '#f43f5e', 6);
    c.font = '700 13px Outfit, sans-serif';
    if (s.F > 0.5) { c.fillStyle = '#10b981'; c.textAlign = 'left'; c.fillText(`F=${fmt(s.F, 0)} N`, BX + 6, ay - 10); }
    if (s.Fs > 0.5) { c.fillStyle = '#f43f5e'; c.textAlign = 'right'; c.fillText(`Fs=${fmt(s.Fs, 0)} N`, BX - 6, ay - 10); }

    // hedefe kalan
    c.textAlign = 'left'; c.font = '700 13px Outfit, sans-serif';
    c.fillStyle = C.muted; c.fillText(`Yüzey: ${SURF[surf].name} (k = ${fmt(SURF[surf].k, 2)})`, 14, 24);
  }

  function updateParticles(dt) {
    const size = blockSize();
    if (s.v > 1 && Math.random() < Math.min(1, s.Fs / 30)) {
      const col = surf === 'sand' ? '#d6b25e' : surf === 'ice' ? '#e0f7ff' : '#cbd5e1';
      s.parts.push({ x: BX - size / 2 - 2, y: GROUND - 2 - Math.random() * 6, vx: -s.v * 3 * PPM / 14 - Math.random() * 40, vy: -20 - Math.random() * 50, life: 0.6, r: 2 + Math.random() * 2.5, color: col });
    }
    for (const p of s.parts) { p.life -= dt; p.x += (p.vx - s.v * PPM) * dt; p.y += p.vy * dt; p.vy += 220 * dt; }
    s.parts = s.parts.filter((p) => p.life > 0 && p.y < H);
  }

  /* --- Çizim: grafikler --- */
  function drawPanel(c, r, title, series, t0, yMin, yMax, unit) {
    c.fillStyle = C.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = C.border; c.lineWidth = 1; c.fillStyle = C.muted; c.font = '11px Inter, sans-serif'; c.textAlign = 'right';
    const Y = (v) => r.y + r.h - ((v - yMin) / (yMax - yMin)) * r.h;
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const v = yMin + ((yMax - yMin) * i) / rows, yy = Y(v);
      c.beginPath(); c.moveTo(r.x, yy); c.lineTo(r.x + r.w, yy); c.stroke();
      c.fillText(fmt(v, Math.abs(yMax - yMin) < 12 ? 1 : 0), r.x - 6, yy + 4);
    }
    if (yMin < 0 && yMax > 0) { c.strokeStyle = C.muted; c.lineWidth = 1.5; c.beginPath(); c.moveTo(r.x, Y(0)); c.lineTo(r.x + r.w, Y(0)); c.stroke(); }
    c.textAlign = 'center';
    for (let i = 0; i <= 6; i++) { const t = t0 + (WINDOW * i) / 6; c.fillText(fmt(t, 0) + ' s', r.x + (r.w * i) / 6, r.y + r.h + 15); }
    // seriler
    c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    for (const se of series) {
      c.strokeStyle = se.color; c.lineWidth = 2.6; c.lineJoin = 'round'; c.beginPath();
      let first = true;
      for (const h of s.hist) {
        if (h.t < t0 - 0.2) continue;
        const px = r.x + ((h.t - t0) / WINDOW) * r.w, py = Y(h[se.key]);
        if (first) { c.moveTo(px, py); first = false; } else c.lineTo(px, py);
      }
      c.stroke();
    }
    c.restore();
    // başlık + gösterge
    c.textAlign = 'left'; c.font = '700 13px Outfit, sans-serif'; c.fillStyle = C.text;
    c.fillText(title + ' (' + unit + ')', r.x, r.y - 8);
    let lx = r.x + r.w; c.textAlign = 'right';
    for (const se of [...series].reverse()) {
      c.fillStyle = se.color; c.fillText('● ' + se.label, lx, r.y - 8); lx -= c.measureText('● ' + se.label).width + 14;
    }
  }

  function drawGraph() {
    const c = gctx;
    c.clearRect(0, 0, gv.width, gv.height);
    c.fillStyle = C.bg; c.fillRect(0, 0, gv.width, gv.height);
    const t0 = Math.max(0, s.t - WINDOW);
    const vis = s.hist.filter((h) => h.t >= t0 - 0.2);
    const fMax = Math.max(80, Math.ceil(Math.max(forceSet, ...vis.map((h) => h.Fs)) / 40) * 40);   // 4 eşit aralık
    drawPanel(c, { x: 52, y: 30, w: gv.width - 70, h: 150 }, 'Kuvvetler', [
      { key: 'F', color: '#10b981', label: 'Uygulanan F' }, { key: 'Fs', color: '#f43f5e', label: 'Sürtünme Fs' },
    ], t0, 0, fMax, 'N');
    const maxV = Math.max(5, ...vis.map((h) => h.v)), maxA = Math.max(...vis.map((h) => h.a), 0), minA = Math.min(...vis.map((h) => h.a), 0);
    const yMin = Math.min(-1, Math.floor(minA * 1.1));
    const yMax = yMin + Math.ceil((Math.ceil(Math.max(maxV, maxA) * 1.1) - yMin) / 4) * 4;   // tam sayı tikler
    drawPanel(c, { x: 52, y: 228, w: gv.width - 70, h: 150 }, 'Hız ve İvme', [
      { key: 'v', color: '#22d3ee', label: 'Hız v (m/s)' }, { key: 'a', color: '#fbbf24', label: 'İvme a (m/s²)' },
    ], t0, yMin, yMax, 'm/s, m/s²');
  }

  /* --- Döngü --- */
  function frame(ts) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
    updateParticles(dt);
    drawScene();
    if (frameNo++ % 2 === 0) { drawGraph(); updateHud(); }
  }

  function start() { if (!active) { active = true; last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); } }
  function stop() { active = false; cancelAnimationFrame(raf); held = false; kb = false; $$('#fr-push, #fr-fab').forEach((b) => b.classList.remove('active-hold')); }

  /* --- Kontroller --- */
  function init() {
    inited = true;
    resetBlock(true);
    updateStats();
    $$('#fr-surfaces .tab').forEach((b) => b.addEventListener('click', () => setSurface(b.dataset.surface)));
    $('#fr-force').addEventListener('input', (e) => { forceSet = +e.target.value; $('#fr-force-v').textContent = forceSet; refreshFormula(); });
    $('#fr-mass').addEventListener('input', (e) => { mass = +e.target.value; $('#fr-mass-v').textContent = mass; resetBlock(false); });
    $('#fr-lock').addEventListener('change', (e) => { lock = e.target.checked; });
    $('#fr-new').addEventListener('click', () => resetBlock(true));
    $('#fr-reset').addEventListener('click', () => resetBlock(false));

    const pbs = [$('#fr-push'), $('#fr-fab')];
    const mark = (on) => pbs.forEach((b) => b.classList.toggle('active-hold', on));
    const down = (e) => { e.preventDefault(); held = true; mark(true); };
    const up = () => { held = false; mark(kb); };
    pbs.forEach((pb) => {
      pb.addEventListener('pointerdown', down);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => pb.addEventListener(ev, up));
      pb.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // sayfadaki "İT" düğmesi görünürken yüzen düğmeyi gizle
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([en]) => $('#fr-fab').classList.toggle('fab-hide', en.isIntersecting)).observe($('#fr-push'));
    }
    window.addEventListener('keydown', (e) => {
      if (!active || e.code !== 'Space') return;
      const t = e.target;
      if (t && t.closest && t.closest('textarea, select, input:not([type=range]):not([type=checkbox])')) return;
      e.preventDefault(); kb = true; mark(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      if (active) e.preventDefault();             // odaktaki düğmenin "tıklanmasını" engelle
      kb = false; mark(held);
    });
    setSurface('concrete');
  }

  function setSurface(name) {
    surf = name;
    $$('#fr-surfaces .tab').forEach((b) => { const on = b.dataset.surface === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    resetBlock(true);
  }

  return {
    enter() { fit(); if (!inited) init(); start(); },
    leave() { stop(); },
    fit() { if (active) fit(); },
    _debug: () => ({ get s() { return s; }, setForce(f) { forceSet = f; }, setHeld(v) { held = v; }, step }),
  };
})();

/* =====================================================
   3) OYUN 3 – ENERJİ DÖNÜŞÜM HIZ TRENİ
   Hareket denklemi ray boyunca: dv/dt = −g·sinφ − μ·N/m
   Döngüde N/m = v²/R + g·cosθ ; N < 0 olursa vagon raydan ayrılır.
   ===================================================== */
const Coaster = (() => {
  const R = 5, LH = 24, X0 = 1.2, RUN = 6, AFTER = 26;           // metre
  const DT = 1 / 240, CW = 960, CHT = 540, SC = 14.4, OX = 54, GY = 492, HIST = 0.05;
  const cv = $('#co-canvas'), ctx = cv.getContext('2d');
  const ch = $('#co-chart'), cctx = ch.getContext('2d');

  let Hh = 15, M = 500, MU = 0, K = 1;                  // K: telefonda yazı/vagon büyütme katsayısı
  const kf = (n) => Math.round(n * K);
  const fit = () => { K = cv.clientWidth && cv.clientWidth < 640 ? 1.9 : 1; };
  let T = null;             // ray
  let sim = null;
  let active = false, inited = false, raf = 0, last = 0, acc = 0, frameNo = 0;

  /* --- Ray oluşturma --- */
  function buildTrack(h) {
    const xs = [], ys = [], th = [], lp = [];
    const sc = 2 / (1 + Math.cos(Math.PI * X0 / LH));            // y(X0) = h olacak şekilde ölçek
    const push = (x, y, t, l) => {
      const n = xs.length;
      if (n && Math.hypot(x - xs[n - 1], y - ys[n - 1]) < 1e-6) return;
      xs.push(x); ys.push(y); th.push(t); lp.push(l);
    };
    for (let x = X0; x <= LH + 1e-9; x += 0.1) push(x - X0, h * sc * (1 + Math.cos(Math.PI * x / LH)) / 2, 0, 0);
    const xEnd = LH - X0;
    for (let x = 0; x <= RUN + 1e-9; x += 0.5) push(xEnd + x, 0, 0, 0);
    const xl = xEnd + RUN;
    for (let t = 0.02; t <= 2 * Math.PI + 1e-9; t += 0.02) push(xl + R * Math.sin(t), R * (1 - Math.cos(t)), t, 1);
    for (let x = 0.5; x <= AFTER + 1e-9; x += 0.5) push(xl + x, 0, 0, 0);
    const ss = [0];
    for (let i = 1; i < xs.length; i++) ss.push(ss[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const loopStartS = ss[lp.indexOf(1)], loopEndS = ss[lp.lastIndexOf(1)];
    return { xs, ys, th, lp, ss, total: ss[ss.length - 1], loopStartS, loopEndS, xl, finishS: ss[ss.length - 1] - 1 };
  }

  function seg(s) {
    const ss = T.ss;
    let lo = 0, hi = ss.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ss[mid] <= s) lo = mid; else hi = mid - 1; }
    const i = lo, ds = ss[i + 1] - ss[i], f = clamp((s - ss[i]) / ds, 0, 1);
    const tx = (T.xs[i + 1] - T.xs[i]) / ds, ty = (T.ys[i + 1] - T.ys[i]) / ds;
    const loop = T.lp[i + 1] === 1;
    return {
      x: T.xs[i] + (T.xs[i + 1] - T.xs[i]) * f, y: T.ys[i] + (T.ys[i + 1] - T.ys[i]) * f,
      tx, ty, loop, th: loop ? T.th[i] + (T.th[i + 1] - T.th[i]) * f : 0,
    };
  }

  function accel(s, v) {
    const g = seg(s);
    const nm = g.loop ? (v * v) / R + G * Math.cos(g.th) : G * Math.abs(g.tx);   // N/m
    const af = MU * Math.max(nm, 0);
    return { a: -G * g.ty - (v >= 0 ? af : -af), nm, g };
  }

  /* --- Simülasyon durumu --- */
  function newSim() {
    const g = seg(0);
    const v0 = 0.5;
    sim = {
      mode: 'idle', s: 0, v: v0, t: 0, x: g.x, y: g.y, ang: 0, nm: G, spin: 0,
      vx: 0, vy: 0, E0: M * G * g.y + 0.5 * M * v0 * v0, hist: [], histT: 0, trail: [], msg: null, topV: null, detachDeg: null,
    };
    sim.ang = Math.atan2(g.ty, g.tx);
    updateFormula(); updateHud(); fillEnergy();
  }

  function setMsg(html, kind = 'info') {
    const el = $('#co-msg');
    el.className = 'msg msg-' + kind + ' mt-4';
    el.innerHTML = html;
  }

  function updateFormula() {
    const ep = M * G * Hh;
    const vt2 = 2 * G * (Hh - 2 * R);
    const vmin = Math.sqrt(G * R);
    let line2;
    if (vt2 <= 0) line2 = `<span style="color:var(--bad)">Tepe, döngünün tepesinden (${2 * R} m) alçak: vagon tepeye çıkamaz.</span>`;
    else {
      const vt = Math.sqrt(vt2), okk = vt >= vmin - 1e-9;
      line2 = `Tepede (sürtünmesiz) v ≈ √(2g(h−2R)) = ${fmt(vt, 1)} m/s <span style="color:var(${okk ? '--good' : '--bad'})">${okk ? '✔' : '✖'} (≥ ${fmt(vmin, 1)} gerek)</span>`;
    }
    $('#co-formula').innerHTML = `Ep = m·g·h = ${M} × 10 × ${fmt(Hh, 1)} = ${fmt(ep / 1000, 1)} kJ<br>${line2}`;
    $('#co-need').textContent = fmt(vmin, 1);
  }

  function fillEnergy() {
    const E0 = sim.E0;
    const ep = M * G * sim.y, ek = sim.mode === 'fly' ? 0.5 * M * (sim.vx ** 2 + sim.vy ** 2) : 0.5 * M * sim.v * sim.v;
    const q = Math.max(0, E0 - ep - ek);
    $('#co-etot').textContent = fmt(E0 / 1000, 1);
    $('#co-ep').textContent = fmt(ep / 1000, 1); $('#co-ek').textContent = fmt(ek / 1000, 1); $('#co-q').textContent = fmt(q / 1000, 1);
    $('#eb-ep').style.width = clamp(ep / E0 * 100, 0, 100) + '%';
    $('#eb-ek').style.width = clamp(ek / E0 * 100, 0, 100) + '%';
    $('#eb-q').style.width = clamp(q / E0 * 100, 0, 100) + '%';
    return { ep, ek, q };
  }

  function updateHud() {
    const speed = sim.mode === 'fly' ? Math.hypot(sim.vx, sim.vy) : sim.v;
    $('#co-v').textContent = fmt(speed, 1);
    $('#co-y').textContent = fmt(sim.y, 1);
    $('#co-g').textContent = fmt(sim.mode === 'fly' ? 0 : clamp(sim.nm / G, 0, 9.9), 1);
  }

  function updateStats() {
    const D = Store.data.coaster;
    $('#co-wins').textContent = D.wins; $('#co-tries').textContent = D.tries; $('#co-best').textContent = D.best;
  }

  /* --- Adım --- */
  function step(dt) {
    if (sim.mode === 'ride') {
      const A1 = accel(sim.s, sim.v);
      const vm = sim.v + A1.a * dt / 2;
      sim.s += vm * dt;
      const A2 = accel(sim.s, vm);
      sim.v = vm + A2.a * dt / 2;
      sim.t += dt;
      const g = A2.g;
      sim.x = g.x; sim.y = g.y; sim.ang = Math.atan2(g.ty, g.tx); sim.nm = A2.nm;
      sim.trail.push({ x: sim.x, y: sim.y, v: sim.v }); if (sim.trail.length > 45) sim.trail.shift();

      if (g.loop && sim.nm < -0.02) {                         // raydan ayrılma
        const deg = Math.round((g.th * 180) / Math.PI);
        sim.mode = 'fly'; sim.vx = g.tx * sim.v; sim.vy = g.ty * sim.v; sim.detachDeg = deg;
        const vmin = Math.sqrt(G * R);
        setMsg(`💥 <b>Vagon raydan ayrıldı!</b> Döngüde ${deg}° noktasında v = ${fmt(sim.v, 1)} m/s idi; ray itme kuvveti (N) sıfırın altına düştü. Tepede v² ≥ g·R ⇒ v ≥ ${fmt(vmin, 1)} m/s gerekir. Enerji korunumundan <b>h ≥ 2,5·R = ${fmt(2.5 * R, 1)} m</b> olmalı (sürtünmesiz). Tepeyi yükselt!`, 'bad');
        Store.save(); updateStats();
      } else if (sim.t > 1.5 && sim.v < 0.05) {
        sim.mode = 'fail';
        const inLoop = sim.s > T.loopStartS && sim.s < T.loopEndS;
        setMsg(inLoop
          ? `🛑 Vagon döngünün alt kısmında durdu: kinetik enerji, potansiyel enerjiye çevrilirken yetmedi (Ek → Ep). Tepeyi yükselt ya da sürtünmeyi azalt.`
          : sim.s >= T.loopEndS
            ? `🛑 Döngüyü geçti ama bitişe ulaşamadı: ray sürtünmesi enerjiyi <b>ısıya</b> çevirdi (Ek → ısı). Sürtünmeyi azalt veya tepeyi yükselt.`
            : `🛑 Vagon tepeden ilerleyemedi: ray sürtünmesi, ağırlığın ray yönündeki bileşeninden büyük. Sürtünmeyi azalt veya tepeyi yükselt.`, 'bad');
      } else if (sim.s >= T.finishS) {
        sim.mode = 'done';
        const sc = Math.max(10, Math.round(100 + MU * 1000 - 4 * (Hh - 2.5 * R)));
        const D = Store.data.coaster; D.wins++; D.best = Math.max(D.best, sc); Store.save(); Store.addXP(sc / 4); updateStats();
        setMsg(`🏁 <b>Başardın!</b> ${sc} puan. Tepedeki Ep, aşağıda Ek'ye dönüştü; döngünün tepesinde v ≥ √(g·R) sağlandı. Daha alçak tepeyle de geçebilir misin? (Kütle sonucu değiştirmez — dene!)`, 'ok');
        celebrate();
      }
      // döngü tepesindeki hız ölçümü
      if (g.loop && Math.abs(g.th - Math.PI) < 0.03) sim.topV = sim.v;
    } else if (sim.mode === 'fly') {
      sim.x += sim.vx * dt; sim.y += sim.vy * dt; sim.vy -= G * dt; sim.t += dt; sim.spin += 6 * dt;
      sim.trail.push({ x: sim.x, y: sim.y, v: Math.hypot(sim.vx, sim.vy) }); if (sim.trail.length > 45) sim.trail.shift();
      if (sim.y <= 0) { sim.y = 0; sim.mode = 'fail'; }
    } else return;

    sim.histT += dt;
    if (sim.histT >= HIST) {
      sim.histT = 0;
      const ep = M * G * sim.y, ek = sim.mode === 'fly' ? 0.5 * M * (sim.vx ** 2 + sim.vy ** 2) : 0.5 * M * sim.v * sim.v;
      sim.hist.push({ t: sim.t, ep, ek, q: Math.max(0, sim.E0 - ep - ek) });
    }
  }

  /* --- Çizim --- */
  const X = (x) => OX + x * SC;
  const Y = (y) => GY - y * SC;

  function drawTrack(c) {
    const n = T.xs.length;
    // tepe gövdesi
    const hillEnd = T.lp.indexOf(1);
    c.beginPath(); c.moveTo(X(T.xs[0]), Y(0));
    for (let i = 0; i < n && T.xs[i] <= LH - X0 + 1e-6 && i < hillEnd; i++) c.lineTo(X(T.xs[i]), Y(T.ys[i]));
    c.lineTo(X(LH - X0), Y(0)); c.closePath();
    const hg = c.createLinearGradient(0, Y(Hh), 0, GY);
    hg.addColorStop(0, C.dark ? 'rgba(167,139,250,0.28)' : 'rgba(124,58,237,0.2)'); hg.addColorStop(1, 'rgba(34,211,238,0.04)');
    c.fillStyle = hg; c.fill();
    // destek çubukları
    c.strokeStyle = C.dark ? 'rgba(167,139,250,0.22)' : 'rgba(124,58,237,0.2)'; c.lineWidth = 2;
    for (let i = 0; i < n && T.xs[i] <= LH - X0 && i < hillEnd; i += 25) { c.beginPath(); c.moveTo(X(T.xs[i]), Y(T.ys[i])); c.lineTo(X(T.xs[i]), GY); c.stroke(); }
    // ray
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.shadowColor = C.accent2; c.shadowBlur = C.dark ? 14 : 6;
    c.strokeStyle = C.accent2; c.lineWidth = 6 * Math.min(K, 1.5);
    c.beginPath(); c.moveTo(X(T.xs[0]), Y(T.ys[0])); for (let i = 1; i < n; i++) c.lineTo(X(T.xs[i]), Y(T.ys[i])); c.stroke();
    c.shadowBlur = 0; c.strokeStyle = C.dark ? '#0b1130' : '#fff'; c.lineWidth = 2 * Math.min(K, 1.5);
    c.beginPath(); c.moveTo(X(T.xs[0]), Y(T.ys[0])); for (let i = 1; i < n; i++) c.lineTo(X(T.xs[i]), Y(T.ys[i])); c.stroke();
    c.restore();
  }

  function drawCart(c, x, y, ang, crashed) {
    c.save();
    c.translate(X(x), Y(y)); c.rotate(-ang); c.scale(K, K);
    c.shadowColor = '#f472b6'; c.shadowBlur = 14;
    const g = c.createLinearGradient(0, -26, 0, -6);
    g.addColorStop(0, '#f472b6'); g.addColorStop(1, '#a78bfa');
    c.fillStyle = g; c.beginPath(); c.roundRect(-21, -25, 42, 17, 6); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.roundRect(-4, -31, 18, 9, 4); c.fill();      // sürücü kabini
    c.fillStyle = '#0f172a'; c.beginPath(); c.arc(-12, -6, 5, 0, 7); c.arc(12, -6, 5, 0, 7); c.fill();
    c.fillStyle = '#e2e8f0'; c.beginPath(); c.arc(-12, -6, 2, 0, 7); c.arc(12, -6, 2, 0, 7); c.fill();
    if (crashed) { c.rotate(ang); c.font = '28px serif'; c.textAlign = 'center'; c.fillText('💥', 0, -20); }
    c.restore();
  }

  function drawScene() {
    const c = ctx;
    const sky = c.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, C.dark ? '#0a0f2c' : '#dbeafe'); sky.addColorStop(1, C.dark ? '#221257' : '#f5f3ff');
    c.fillStyle = sky; c.fillRect(0, 0, CW, CHT);
    if (C.dark) { c.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 60; i++) c.fillRect((i * 173) % CW, (i * 97) % (GY - 40), 2, 2); }
    // zemin
    c.fillStyle = C.dark ? '#111a38' : '#cbd5e1'; c.fillRect(0, GY, CW, CHT - GY);
    c.fillStyle = C.dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)'; c.fillRect(0, GY - 1, CW, 3);
    c.font = `600 ${kf(11)}px Inter, sans-serif`; c.textAlign = 'center'; c.fillStyle = C.muted;
    for (let m = 0; m <= 60; m += 10) { c.fillRect(X(m) - 1, GY, 2, 8); c.fillText(m + ' m', X(m), GY + 22); }

    // yükseklik çizgileri (cetvel)
    c.save();
    c.strokeStyle = C.muted; c.fillStyle = C.muted; c.setLineDash([5, 5]); c.lineWidth = 1; c.font = `700 ${kf(12)}px Outfit, sans-serif`;
    c.textAlign = 'left';
    c.beginPath(); c.moveTo(X(0) - 20, GY); c.lineTo(X(0) - 20, Y(Hh)); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.moveTo(X(0) - 26, Y(Hh)); c.lineTo(X(0) - 14, Y(Hh)); c.stroke();
    c.fillStyle = C.accent; c.fillText(`h = ${fmt(Hh, 1)} m`, X(0) + 8, Y(Hh) - 12);
    // döngü yarıçapı
    c.setLineDash([4, 4]); c.strokeStyle = C.warn; c.fillStyle = C.warn;
    c.beginPath(); c.moveTo(X(T.xl), Y(0)); c.lineTo(X(T.xl), Y(2 * R)); c.stroke();
    c.setLineDash([]); c.textAlign = 'center';
    c.fillText(`2R = ${2 * R} m`, X(T.xl), Y(R) + 4);
    // kritik yükseklik ipucu (ilk denemeden sonra)
    if (Store.data.coaster.tries > 0) {
      c.setLineDash([2, 6]); c.strokeStyle = C.good; c.fillStyle = C.good; c.textAlign = 'left';
      c.beginPath(); c.moveTo(X(0), Y(2.5 * R)); c.lineTo(X(T.xl - R - 10), Y(2.5 * R)); c.stroke();
      c.fillText(`h = 2,5R = ${fmt(2.5 * R, 1)} m`, X(T.xl - R - 10) + 6, Y(2.5 * R) + 4);
    }
    c.restore();

    drawTrack(c);

    // bitiş
    const fx = X(T.xs[T.xs.length - 1] - 1);
    c.fillStyle = C.text; c.fillRect(fx, Y(5), 3, 5 * SC);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) { c.fillStyle = (r + q) % 2 ? '#111' : '#fff'; c.fillRect(fx + 3 + q * 8, Y(5) + r * 8, 8, 8); }

    // iz
    for (let i = 1; i < sim.trail.length; i++) {
      const p = sim.trail[i], q = sim.trail[i - 1];
      c.strokeStyle = `rgba(244,114,182,${i / sim.trail.length * 0.7})`; c.lineWidth = 4 * i / sim.trail.length;
      c.beginPath(); c.moveTo(X(q.x), Y(q.y)); c.lineTo(X(p.x), Y(p.y)); c.stroke();
    }
    // vagon
    drawCart(c, sim.x, sim.y, sim.mode === 'fly' ? sim.spin : sim.ang, sim.mode === 'fail' && sim.detachDeg !== null);

    if (sim.mode === 'done') { c.font = `800 ${Math.round(34 * (K > 1 ? 1.4 : 1))}px Outfit, sans-serif`; c.textAlign = 'center'; c.fillStyle = C.good; c.fillText('🏁 BAŞARILI!', CW / 2, 64); }
    if (sim.mode === 'fail') { c.font = `800 ${Math.round(30 * (K > 1 ? 1.4 : 1))}px Outfit, sans-serif`; c.textAlign = 'center'; c.fillStyle = C.bad; c.fillText(sim.detachDeg !== null ? '💥 RAYDAN AYRILDI' : '🛑 DURDU', CW / 2, 64); }
  }

  function drawChart() {
    const c = cctx, w = ch.width, h = ch.height;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, h);
    const r = { x: 44, y: 18, w: w - 58, h: h - 52 };
    const tmax = Math.max(8, Math.ceil((sim.t + 0.5) / 2) * 2), ymax = sim.E0 * 1.08;
    c.strokeStyle = C.border; c.fillStyle = C.muted; c.font = '11px Inter, sans-serif'; c.lineWidth = 1; c.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const yy = r.y + r.h - (r.h * i) / 4;
      c.beginPath(); c.moveTo(r.x, yy); c.lineTo(r.x + r.w, yy); c.stroke();
      c.fillText(fmt((ymax * i) / 4 / 1000, 0), r.x - 5, yy + 3);
    }
    c.textAlign = 'center';
    for (let i = 0; i <= 4; i++) c.fillText(fmt((tmax * i) / 4, 0) + ' s', r.x + (r.w * i) / 4, r.y + r.h + 14);
    c.textAlign = 'left'; c.fillText('kJ', 6, 12);
    const px = (t) => r.x + (t / tmax) * r.w, py = (e) => r.y + r.h - (e / ymax) * r.h;
    const line = (key, color) => {
      c.strokeStyle = color; c.lineWidth = 2.4; c.beginPath();
      sim.hist.forEach((p, i) => (i ? c.lineTo(px(p.t), py(p[key])) : c.moveTo(px(p.t), py(p[key]))));
      c.stroke();
    };
    c.setLineDash([4, 4]); c.strokeStyle = C.muted; c.beginPath(); c.moveTo(r.x, py(sim.E0)); c.lineTo(r.x + r.w, py(sim.E0)); c.stroke(); c.setLineDash([]);
    line('ep', '#a78bfa'); line('ek', '#22d3ee'); line('q', '#fb7185');
    c.font = '700 12px Outfit, sans-serif';
    c.fillStyle = '#a78bfa'; c.fillText('Ep', r.x + 4, h - 5);
    c.fillStyle = '#22d3ee'; c.fillText('Ek', r.x + 32, h - 5);
    c.fillStyle = '#fb7185'; c.fillText('Isı', r.x + 60, h - 5);
    c.fillStyle = C.muted; c.fillText('- - toplam', r.x + 96, h - 5);
  }

  function frame(ts) {
    if (!active) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
    drawScene();
    if (frameNo++ % 2 === 0) { fillEnergy(); updateHud(); drawChart(); }
  }

  function start() { if (!active) { active = true; last = performance.now(); acc = 0; raf = requestAnimationFrame(frame); } }
  function stop() { active = false; cancelAnimationFrame(raf); }

  function launch() {
    newSim();
    sim.mode = 'ride';
    const D = Store.data.coaster; D.tries++; Store.save(); updateStats();
    setMsg('Vagon yola çıktı! Enerji dönüşümünü ve koltuk baskısını izle…', 'info');
  }

  function resetAll() {
    T = buildTrack(Hh);
    newSim();
    setMsg(`Döngü yarıçapı R = ${R} m. Tepeyi ayarla ve <b>Bırak!</b> düğmesine bas.`, 'info');
  }

  function init() {
    inited = true;
    $('#co-h').addEventListener('input', (e) => { Hh = +e.target.value; $('#co-h-v').textContent = fmt(Hh, 1); resetAll(); });
    $('#co-m').addEventListener('input', (e) => { M = +e.target.value; $('#co-m-v').textContent = M; resetAll(); });
    $('#co-mu').addEventListener('input', (e) => { MU = +e.target.value; $('#co-mu-v').textContent = fmt(MU, 3); resetAll(); });
    $('#co-go').addEventListener('click', () => { T = buildTrack(Hh); launch(); });
    $('#co-reset').addEventListener('click', resetAll);
    $('#co-h-v').textContent = fmt(Hh, 1);
    resetAll(); updateStats();
  }

  return {
    enter() { fit(); if (!inited) init(); start(); },
    leave() { stop(); },
    fit() { if (active) fit(); },
    _debug: () => ({ get sim() { return sim; }, setParams(h, m, mu) { Hh = h; M = m; MU = mu; resetAll(); }, launch: () => { T = buildTrack(Hh); launch(); }, step }),
  };
})();

/* =====================================================
   4) QUIZ + SKOR TABLOSU
   Soru formatı: o[0] doğru cevaptır, seçenekler her seferinde karıştırılır.
   ===================================================== */
const CATS = [
  { id: 'tum', name: '🌟 Karışık', sub: 'Tüm üniteler' },
  { id: 'giris', name: '📏 Fizik Bilimine Giriş', sub: 'Birim, büyüklük, yöntem' },
  { id: 'madde', name: '🧪 Madde ve Özellikleri', sub: 'Özkütle, adezyon…' },
  { id: 'hareket', name: '🧱 Hareket ve Kuvvet', sub: 'Newton, sürtünme, ivme' },
  { id: 'enerji', name: '🎢 Enerji', sub: 'Ep, Ek, iş, güç, verim' },
];

const QUESTIONS = [
  // --- Fizik Bilimine Giriş ---
  { c: 'giris', q: 'Aşağıdaki büyüklüklerden hangisi vektörel bir büyüklüktür?', o: ['Kuvvet', 'Kütle', 'Zaman', 'Sürat'], e: 'Kuvvetin büyüklüğü yanında yönü de vardır. Kütle, zaman ve sürat skaler büyüklüklerdir.' },
  { c: 'giris', q: 'Aşağıdakilerden hangisi skaler bir büyüklüktür?', o: ['Kütle', 'Hız', 'İvme', 'Kuvvet'], e: 'Skaler büyüklükler yalnızca sayı ve birimle ifade edilir; kütle böyledir. Hız, ivme ve kuvvet vektöreldir.' },
  { c: 'giris', q: 'SI birim sisteminde uzunluğun birimi aşağıdakilerden hangisidir?', o: ['Metre', 'Kilogram', 'Saniye', 'Joule'], e: 'SI’da uzunluk metre (m), kütle kilogram (kg), zaman saniye (s) ile ölçülür.' },
  { c: 'giris', q: 'Aşağıdakilerden hangisi türetilmiş büyüklüktür?', o: ['Hız', 'Uzunluk', 'Kütle', 'Zaman'], e: 'Hız = yol / zaman olduğundan uzunluk ve zamandan türetilir.' },
  { c: 'giris', q: 'Fizikte mekanik alt dalı neyi inceler?', o: ['Cisimlerin hareketini ve kuvveti', 'Işığın davranışını', 'Elektrik yüklerini', 'Atom çekirdeğini'], e: 'Mekanik; hareketi, kuvveti ve enerjiyi inceler. Işığı optik, elektrik yüklerini elektrik dalı inceler.' },
  { c: 'giris', q: 'Hipotez nedir?', o: ['Problemin çözümü için ileri sürülen, test edilebilir geçici açıklama', 'Deneyden elde edilen kesin sonuç', 'Bilimsel yasanın başka adı', 'Yalnızca gözlem sonucu yazılan not'], e: 'Hipotez deneyle sınanır; doğrulanırsa kuramın/yasanın bir parçası olabilir.' },
  { c: 'giris', q: 'Aynı büyüklüğü birkaç kez ölçüp ortalamasını almanın amacı nedir?', o: ['Rastgele hata payını azaltmak', 'Birimi değiştirmek', 'Büyüklüğü vektörel yapmak', 'Ölçü aletini kalibre etmek'], e: 'Tekrarlı ölçümlerin ortalaması, rastgele hataların etkisini azaltır.' },
  { c: 'giris', q: '5 cm uzunluğu metre cinsinden yazarsak aşağıdakilerden hangisi olur?', o: ['0,05 m', '0,5 m', '5 m', '0,005 m'], e: '1 cm = 0,01 m olduğundan 5 cm = 0,05 m’dir.' },
  { c: 'giris', q: 'Bilimsel bir çalışmada genellikle ilk adım nedir?', o: ['Gözlem yapıp problemi belirlemek', 'Sonucu yazmak', 'Yasa ilan etmek', 'Hipotezi doğrulanmış kabul etmek'], e: 'Süreç: gözlem → problem → hipotez → deney → sonuç ve yorum şeklinde ilerler.' },
  { c: 'giris', q: 'Fiziğin ışık olaylarını inceleyen alt dalı hangisidir?', o: ['Optik', 'Termodinamik', 'Akustik', 'Atom fiziği'], e: 'Optik; ışığın yayılması, yansıması, kırılması gibi olayları inceler.' },
  // --- Madde ve Özellikleri ---
  { c: 'madde', q: 'Kütlesi 200 g, hacmi 50 cm³ olan cismin özkütlesi kaç g/cm³ tür?', o: ['4', '0,25', '2', '10'], e: 'd = m / V = 200 / 50 = 4 g/cm³.' },
  { c: 'madde', q: 'Aynı sıcaklıkta aynı maddeden yapılmış iki cismin özkütleleri için ne söylenebilir?', o: ['Eşittir; özkütle ayırt edici bir özelliktir', 'Büyük olanın özkütlesi daha fazladır', 'Hacmi büyük olanın özkütlesi küçüktür', 'Kütlesi büyük olanın özkütlesi küçüktür'], e: 'Özkütle maddeye özgüdür; cismin miktarına bağlı değildir.' },
  { c: 'madde', q: 'Buz neden suda yüzer?', o: ['Özkütlesi sudan küçüktür', 'Kütlesi sudan küçüktür', 'Hacmi sudan büyüktür', 'Soğuk olduğu için'], e: 'Buzun özkütlesi (≈0,9 g/cm³) suyunkinden (1 g/cm³) küçüktür; daha az yoğun olan cisim yüzer.' },
  { c: 'madde', q: 'Birbirine karışmadığı varsayılan su (1 g/cm³) ve alkol (0,8 g/cm³) aynı kaba konursa hangisi üstte kalır?', o: ['Özkütlesi 0,8 olan alkol', 'Özkütlesi 1 olan su', 'İkisi de aynı düzeyde durur', 'Hacmi büyük olan'], e: 'Özkütlesi küçük olan sıvı, özkütlesi büyük olanın üstünde yer alır.' },
  { c: 'madde', q: 'Bir cisim ikiye bölünürse özkütlesi nasıl değişir?', o: ['Değişmez', 'Yarıya iner', 'İki katına çıkar', 'Dörtte birine iner'], e: 'Kütle ve hacim aynı oranda azalır; d = m/V değişmez.' },
  { c: 'madde', q: 'Aynı cins moleküller arasındaki çekim kuvvetine ne ad verilir?', o: ['Kohezyon', 'Adezyon', 'Kılcallık', 'Yüzey gerilimi'], e: 'Aynı cins moleküller arası çekim kohezyon, farklı cins moleküller arası çekim adezyondur.' },
  { c: 'madde', q: 'Bitkilerde suyun köklerden yapraklara taşınmasında hangi olay etkilidir?', o: ['Kılcallık', 'Eylemsizlik', 'Esneklik', 'Genleşme'], e: 'Dar borularda adezyon ve kohezyonun birlikte etkisiyle sıvı yükselir; buna kılcallık denir.' },
  { c: 'madde', q: 'Bazı böceklerin su yüzeyinde batmadan yürüyebilmesi hangi olayla açıklanır?', o: ['Yüzey gerilimi', 'Basınç', 'Genleşme', 'Isı iletimi'], e: 'Yüzeydeki moleküllerin kohezyon nedeniyle oluşturduğu "gergin zar" böceği taşır.' },
  { c: 'madde', q: 'Kütlesi 90 g, özkütlesi 0,9 g/cm³ olan cismin hacmi kaç cm³ tür?', o: ['100', '81', '10', '0,01'], e: 'V = m / d = 90 / 0,9 = 100 cm³.' },
  { c: 'madde', q: 'Özkütlesi 2 g/cm³ olan maddeden yapılmış 10 cm³ hacmindeki cismin kütlesi kaç g dır?', o: ['20', '5', '0,2', '12'], e: 'm = d · V = 2 · 10 = 20 g.' },
  // --- Hareket ve Kuvvet ---
  { c: 'hareket', q: '36 km/h hız kaç m/s dir?', o: ['10', '36', '3,6', '100'], e: 'km/h → m/s için 3,6’ya bölünür: 36 / 3,6 = 10 m/s.' },
  { c: 'hareket', q: 'Kütlesi 5 kg olan cisme 20 N net kuvvet uygulanırsa ivmesi kaç m/s² olur?', o: ['4', '100', '0,25', '15'], e: 'F = m·a ⇒ a = 20 / 5 = 4 m/s².' },
  { c: 'hareket', q: 'Sürtünme kuvveti aşağıdakilerden hangisine bağlı değildir?', o: ['Temas yüzeyinin alanına', 'Yüzeyin cinsine', 'Cismin ağırlığına', 'Yüzeye dik kuvvete'], e: 'Fs = k·N; yüzey cinsi (k) ve dik kuvvet (N) belirleyicidir, temas alanı etkili değildir.' },
  { c: 'hareket', q: 'Net kuvvetin sıfır olduğu bir cisim için ne söylenebilir?', o: ['Durgunsa durur, hareketliyse sabit hızla gider', 'Hızı sürekli artar', 'Hızı sürekli azalır', 'Mutlaka durgundur'], e: 'Newton’un 1. yasası (eylemsizlik): net kuvvet sıfırsa cismin hareket durumu değişmez.' },
  { c: 'hareket', q: 'Durgun halden harekete geçen bir araç 5 s sonunda 20 m/s hıza ulaşıyor. İvmesi kaç m/s² dir?', o: ['4', '100', '25', '0,25'], e: 'a = Δv / Δt = 20 / 5 = 4 m/s².' },
  { c: 'hareket', q: 'Bir kişi duvarı 50 N kuvvetle iterse duvar kişiye nasıl bir kuvvet uygular?', o: ['50 N, zıt yönde', '50 N, aynı yönde', '0 N', '100 N, zıt yönde'], e: 'Newton’un 3. yasası: etki–tepki kuvvetleri eşit büyüklükte ve zıt yönlüdür.' },
  { c: 'hareket', q: 'Konum–zaman grafiğinde doğrunun eğimi neyi verir?', o: ['Hızı', 'İvmeyi', 'Kuvveti', 'Alınan yolu'], e: 'Eğim = Δx / Δt = hızdır.' },
  { c: 'hareket', q: 'Kütlesi 6 kg olan cismin (g = 10 m/s²) ağırlığı kaç N dir?', o: ['60', '6', '16', '0,6'], e: 'G = m·g = 6 · 10 = 60 N.' },
  { c: 'hareket', q: 'Buzlu zeminde bir cisim neden daha uzağa kayar?', o: ['Sürtünme katsayısı küçük olduğu için', 'Sürtünme katsayısı büyük olduğu için', 'Cismin kütlesi azaldığı için', 'Yerçekimi azaldığı için'], e: 'Buzda k küçüktür; Fs = k·N küçük olduğundan yavaşlatma azdır, cisim uzağa gider.' },
  { c: 'hareket', q: 'Sabit hızla giden bir aracın ivmesi kaçtır?', o: ['0', 'Hızına eşit', 'Sürekli artar', 'Sonsuzdur'], e: 'İvme hızın değişim oranıdır; hız değişmiyorsa ivme sıfırdır.' },
  // --- Enerji ---
  { c: 'enerji', q: 'Kütlesi 2 kg olan cisim 5 m yüksekte ise potansiyel enerjisi kaç J dir? (g = 10 m/s²)', o: ['100', '10', '50', '25'], e: 'Ep = m·g·h = 2 · 10 · 5 = 100 J.' },
  { c: 'enerji', q: 'Kütlesi 4 kg olan cismin 5 m/s hızdaki kinetik enerjisi kaç J dir?', o: ['50', '100', '20', '10'], e: 'Ek = ½·m·v² = ½ · 4 · 25 = 50 J.' },
  { c: 'enerji', q: 'Sürtünmesiz ortamda 20 m yükseklikten serbest bırakılan cismin yere çarpma hızı kaç m/s dir? (g = 10)', o: ['20', '10', '40', '200'], e: 'm·g·h = ½·m·v² ⇒ v = √(2·g·h) = √(2·10·20) = 20 m/s.' },
  { c: 'enerji', q: '10 N kuvvet, cismi kuvvet doğrultusunda 5 m yol aldırırsa yapılan iş kaç J dir?', o: ['50', '2', '15', '0,5'], e: 'W = F · x = 10 · 5 = 50 J.' },
  { c: 'enerji', q: '200 J işi 10 s’de yapan makinenin gücü kaç W tır?', o: ['20', '2000', '190', '0,05'], e: 'P = W / t = 200 / 10 = 20 W.' },
  { c: 'enerji', q: 'Verimi %80 olan bir makineye 500 J enerji verilirse yararlı enerji kaç J olur?', o: ['400', '625', '100', '80'], e: 'Verim = yararlı / verilen ⇒ yararlı = 0,8 · 500 = 400 J.' },
  { c: 'enerji', q: 'Aşağıdakilerden hangisi yenilenebilir enerji kaynağıdır?', o: ['Rüzgâr', 'Kömür', 'Doğal gaz', 'Petrol'], e: 'Rüzgâr, güneş, su gibi kaynaklar tükenmez; fosil yakıtlar tükenir.' },
  { c: 'enerji', q: 'Hız treni tepeden aşağı inerken (sürtünme ihmal) enerji dönüşümü nasıldır?', o: ['Potansiyel enerji kinetik enerjiye dönüşür', 'Kinetik enerji potansiyel enerjiye dönüşür', 'Enerji yok olur', 'Toplam enerji artar'], e: 'Yükseklik azalırken Ep azalır, hız artarken Ek artar; toplam mekanik enerji korunur.' },
  { c: 'enerji', q: 'Mekanik enerjinin korunumu hangi durumda geçerlidir?', o: ['Sürtünme ve diğer kayıpların ihmal edildiği durumda', 'Her zaman, ne olursa olsun', 'Sadece durgun cisimlerde', 'Sadece yatay yüzeylerde'], e: 'Sürtünme varsa mekanik enerjinin bir kısmı ısıya dönüşür; toplam enerji yine korunur ama mekanik enerji azalır.' },
  { c: 'enerji', q: 'Aşağıdakilerden hangisi enerji birimidir?', o: ['Joule', 'Newton', 'Watt', 'Pascal'], e: 'Enerji ve iş birimi joule (J), güç birimi watt (W), kuvvet birimi newton (N)’dur.' },
];

const Quiz = (() => {
  const ROUND = 10, TIME = 20;
  let cat = 'tum', list = [], i = 0, score = 0, correct = 0, streak = 0, timeLeft = TIME, timer = null, answered = false, inited = false, saved = false;

  const show = (id) => ['qz-start', 'qz-play', 'qz-end'].forEach((x) => $('#' + x).classList.toggle('hidden', x !== id));

  function renderCats() {
    $('#qz-cats').innerHTML = CATS.map((c) => {
      const n = c.id === 'tum' ? QUESTIONS.length : QUESTIONS.filter((q) => q.c === c.id).length;
      return `<button class="cat ${c.id === cat ? 'active' : ''}" data-cat="${c.id}">${c.name}<small>${c.sub} • ${n} soru</small></button>`;
    }).join('');
    $('#qz-high').textContent = Store.data.quiz.high;
  }

  function begin() {
    const pool = cat === 'tum' ? QUESTIONS : QUESTIONS.filter((q) => q.c === cat);
    list = shuffle(pool.slice()).slice(0, ROUND);
    i = 0; score = 0; correct = 0; streak = 0; saved = false;
    show('qz-play');
    ask();
  }

  function ask() {
    answered = false;
    const q = list[i];
    const opts = shuffle(q.o.map((t, idx) => ({ t, ok: idx === 0 })));
    $('#qz-progress').textContent = `Soru ${i + 1}/${list.length}`;
    $('#qz-score').textContent = 'Puan: ' + score;
    $('#qz-streak').textContent = '🔥 ' + streak;
    $('#qz-question').textContent = q.q;
    $('#qz-options').innerHTML = opts.map((o, n) => `<button class="qz-opt" data-ok="${o.ok ? 1 : 0}"><span class="k">${'ABCD'[n]}</span><span>${esc(o.t)}</span></button>`).join('');
    $('#qz-explain').classList.add('hidden');
    $('#qz-next').classList.add('hidden');
    timeLeft = TIME; tick();
    clearInterval(timer);
    timer = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 0.1);
      tick();
      if (timeLeft <= 0) reveal(null);
    }, 100);
  }

  function tick() {
    const t = $('#qz-timer');
    t.style.transform = `scaleX(${timeLeft / TIME})`;
    t.style.backgroundPosition = `${(1 - timeLeft / TIME) * 100}% 0`;
  }

  function reveal(btn) {
    if (answered) return;
    answered = true;
    clearInterval(timer);
    const q = list[i];
    const isOk = !!btn && btn.dataset.ok === '1';
    $$('#qz-options .qz-opt').forEach((b) => {
      b.disabled = true;
      if (b.dataset.ok === '1') b.classList.add('ok');
      else if (b === btn) b.classList.add('no');
    });
    let head;
    if (isOk) {
      const bonus = clamp(Math.floor(timeLeft / 4), 0, 5);
      score += 10 + bonus; correct++; streak++;
      head = `✔ <b>Doğru!</b> +${10 + bonus} puan${bonus ? ` (hız bonusu +${bonus})` : ''}. `;
    } else {
      streak = 0;
      head = btn ? '✖ <b>Yanlış.</b> ' : '⏰ <b>Süre doldu.</b> ';
    }
    const ex = $('#qz-explain');
    ex.className = 'msg mt-4 ' + (isOk ? 'msg-ok' : 'msg-bad');
    ex.innerHTML = head + esc(q.e);
    $('#qz-score').textContent = 'Puan: ' + score;
    $('#qz-streak').textContent = '🔥 ' + streak;
    const nx = $('#qz-next');
    nx.textContent = i + 1 >= list.length ? 'Sonucu Gör 🏆' : 'Sonraki →';
    nx.classList.remove('hidden'); nx.focus({ preventScroll: true });
  }

  function end() {
    clearInterval(timer);
    const D = Store.data.quiz;
    const newRecord = score > D.high;
    if (newRecord) D.high = score;
    Store.save(); Store.addXP(score / 3);
    const ratio = correct / list.length;
    $('#qz-end-emoji').textContent = ratio >= 0.9 ? '🏆' : ratio >= 0.6 ? '🎉' : ratio >= 0.4 ? '👍' : '📚';
    $('#qz-end-title').textContent = ratio >= 0.9 ? 'Muhteşem fizikçi!' : ratio >= 0.6 ? 'Harika iş!' : ratio >= 0.4 ? 'Fena değil!' : 'Biraz daha çalışalım';
    $('#qz-end-sub').textContent = newRecord ? '🎊 Yeni rekor kırdın!' : 'Rekorunu geçmek için tekrar dene.';
    $('#qz-end-score').textContent = score;
    $('#qz-end-correct').textContent = `${correct}/${list.length}`;
    $('#qz-end-high').textContent = D.high;
    try { $('#qz-name').value = localStorage.getItem('fizikLab.name') || ''; } catch (e) { /* yoksay */ }
    $('#qz-save').classList.remove('hidden');
    show('qz-end');
    if (ratio >= 0.6) celebrate();
  }

  function init() {
    inited = true;
    $('#qz-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      cat = b.dataset.cat; renderCats();
    });
    $('#qz-begin').addEventListener('click', begin);
    $('#qz-options').addEventListener('click', (e) => { const b = e.target.closest('.qz-opt'); if (b) reveal(b); });
    $('#qz-next').addEventListener('click', () => { if (i + 1 >= list.length) end(); else { i++; ask(); } });
    $('#qz-again').addEventListener('click', () => { show('qz-start'); renderCats(); });
    $('#qz-save').addEventListener('submit', (e) => {
      e.preventDefault();
      if (saved) return;
      const name = $('#qz-name').value.trim().slice(0, 16) || 'Anonim';
      const D = Store.data.quiz;
      D.board.push({ name, score, cat, date: Date.now() });
      D.board.sort((a, b) => b.score - a.score || a.date - b.date);
      D.board = D.board.slice(0, 10);
      Store.save();
      try { localStorage.setItem('fizikLab.name', name); } catch (err) { /* yoksay */ }
      saved = true; $('#qz-save').classList.add('hidden');
      toast('Skorun kaydedildi! 🏆', 'ok');
    });
    window.addEventListener('keydown', (e) => {   // klavye kısayolları: A-D / 1-4, Enter
      if (Router.current !== 'quiz' || $('#qz-play').classList.contains('hidden')) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const idx = 'abcd'.indexOf(e.key.toLowerCase());
      const n = idx >= 0 ? idx : '1234'.indexOf(e.key);
      if (n >= 0 && !answered) { const b = $$('#qz-options .qz-opt')[n]; if (b) reveal(b); }
      else if (e.key === 'Enter' && answered) $('#qz-next').click();
    });
  }

  return {
    enter(param) {
      if (!inited) init();
      if (param && CATS.some((c) => c.id === param)) cat = param;
      clearInterval(timer);
      show('qz-start'); renderCats();
    },
    leave() { clearInterval(timer); },
  };
})();

const Scores = (() => {
  const MEDALS = ['🥇', '🥈', '🥉'];
  let inited = false;
  function render() {
    const D = Store.data;
    const board = D.quiz.board;
    $('#sc-board').innerHTML = board.length
      ? board.map((b, n) => `<li><span class="rk">${MEDALS[n] || n + 1}</span><span>${esc(b.name)}<small>${esc((CATS.find((c) => c.id === b.cat) || {}).name || '')} • ${new Date(b.date).toLocaleDateString('tr-TR')}</small></span><b>${b.score}</b></li>`).join('')
      : '<li class="empty">Henüz kayıtlı skor yok. Quiz’i oyna ve adını kaydet!</li>';
    const lv = ['Seviye 1 · Üç Sıvı', 'Seviye 2 · Beş Sıvı', 'Seviye 3 · Cisimler'];
    $('#sc-games').innerHTML = `
      <div class="gcard"><b>🧪 Özkütle & Sıvı Kulesi</b>${lv.map((n, k) => { const r = D.density[k]; return `<div class="row"><span>${n}</span><b>${r ? stars(r.stars) + ' • ' + r.score : '—'}</b></div>`; }).join('')}</div>
      <div class="gcard"><b>🧱 Sürtünme & İvme Parkuru</b><div class="row"><span>Hedefi tutturma</span><b>${D.friction.wins}</b></div><div class="row"><span>En iyi puan</span><b>${D.friction.best}</b></div></div>
      <div class="gcard"><b>🎢 Enerji Hız Treni</b><div class="row"><span>Başarılı geçiş / deneme</span><b>${D.coaster.wins} / ${D.coaster.tries}</b></div><div class="row"><span>En iyi puan</span><b>${D.coaster.best}</b></div></div>
      <div class="gcard"><b>🧠 Quiz</b><div class="row"><span>Yüksek skor</span><b>${D.quiz.high}</b></div><div class="row"><span>Toplam XP</span><b>${D.xp}</b></div></div>`;
  }
  return {
    enter() {
      if (!inited) {
        inited = true;
        $('#sc-clear').addEventListener('click', () => {
          if (confirm('Tüm skorlar ve ilerleme silinsin mi?')) { Store.reset(); render(); toast('Veriler sıfırlandı.'); }
        });
      }
      render();
    },
  };
})();

/* =====================================================
   5) BAŞLATMA
   ===================================================== */
Store.load();
Theme.init();
UI.refresh();
Router.modules = {
  home: { enter() { UI.refresh(); } },
  density: Density,
  friction: Friction,
  coaster: Coaster,
  quiz: Quiz,
  scores: Scores,
};
window.addEventListener('resize', () => { Friction.fit(); Coaster.fit(); });
Router.init();
