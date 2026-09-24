/* ---------- State ---------- */

let me = null;
let socket = null;
let friendsData = { accepted: [], incoming: [], outgoing: [] };
let inboxByFriend = new Map(); // friendId -> last message
let activeFriendId = null;
let messagesByFriend = new Map(); // friendId -> [messages]
let localImageCache = new Map(); // messageId -> dataURL (own sent snaps + just-viewed snaps)
let replyingTo = null; // message object

let cameraStream = null;
let capturedDataUrl = null;
let currentFacingMode = 'user';
let pendingViewerTimer = null;
let currentFilterId = 'none';
let chatBackgrounds = [];

let activeGameSessionId = null;
let activeGameCleanup = null;
let pendingInviteId = null;
let incomingInvite = null;

const els = {};

/* ---------- Utilities ---------- */

function $(id) { return document.getElementById(id); }

function toast(text) {
  const stack = $('toast-stack');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Hata oluştu.');
  return data;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Hata oluştu.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// Bitmoji-style SVG when the user designed one, colored initials otherwise.
function avatarInner(u) {
  return u.avatarConfig ? SnoopAvatar.render(u.avatarConfig) : escapeHtml(initials(u.displayName));
}

function avatarHtml(u, sizeClass = 'sm') {
  const cls = `avatar ${sizeClass}${u.avatarConfig ? ' has-bitmoji' : ''}`;
  return `<div class="${cls}" style="background:${u.avatarConfig ? 'transparent' : u.avatarColor}">${avatarInner(u)}</div>`;
}

function paintAvatar(el, u) {
  el.classList.toggle('has-bitmoji', !!u.avatarConfig);
  el.style.background = u.avatarConfig ? 'transparent' : u.avatarColor;
  el.innerHTML = avatarInner(u);
}

function timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'Z');
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
}

function lastReadKey(friendId) { return `snap_last_read_${friendId}`; }
function getLastRead(friendId) { return Number(localStorage.getItem(lastReadKey(friendId)) || 0); }
function setLastRead(friendId) { localStorage.setItem(lastReadKey(friendId), String(Date.now())); }

/* ---------- Init ---------- */

async function init() {
  const meRes = await getJSON('/api/auth/me');
  if (!meRes.user) {
    window.location.href = '/index.html';
    return;
  }
  me = meRes.user;
  applyMeUI();

  connectSocket();
  bindUI();
  await Promise.all([loadFriends(), loadInbox()]);
  renderSidebar();
}

function applyMeUI() {
  $('my-name').innerHTML = escapeHtml(me.displayName) + (me.plusActive ? ' <span class="plus-badge">✨ PLUS</span>' : '');
  $('my-username').textContent = '@' + me.username;
  paintAvatar($('my-avatar'), me);
  $('admin-link-btn').classList.toggle('hidden', !me.isAdmin);
}

function connectSocket() {
  socket = io();
  socket.on('message:new', (msg) => {
    const friendId = msg.senderId === me.id ? msg.receiverId : msg.senderId;
    const isNew = addMessageIfNew(friendId, msg);
    inboxByFriend.set(friendId, msg);
    if (isNew) {
      if (activeFriendId === friendId) {
        appendMessageDOM(msg);
        scrollMessagesToBottom();
      } else if (msg.senderId !== me.id) {
        toast(`${friendNameById(friendId)} sana bir ${msg.type === 'snap' ? 'snap' : 'mesaj'} gönderdi`);
      }
    }
    renderSidebar();
  });

  socket.on('message:viewed', ({ id, viewedAt }) => {
    for (const arr of messagesByFriend.values()) {
      const m = arr.find((x) => x.id === id);
      if (m) { m.viewedAt = viewedAt; m.hasImage = false; }
    }
    const row = document.querySelector(`[data-msg-id="${id}"]`);
    if (row) updateSnapCardEl(row);
  });

  socket.on('friend:request', ({ from }) => {
    toast(`${from.displayName} sana arkadaşlık isteği gönderdi`);
    loadFriends().then(renderSidebar);
  });

  socket.on('friend:accepted', ({ by }) => {
    toast(`${by.displayName} arkadaşlık isteğini kabul etti`);
    loadFriends().then(renderSidebar);
  });

  socket.on('friend:streak', ({ friendId, streak }) => {
    const f = friendsData.accepted.find((x) => x.id === friendId);
    if (f) f.streak = streak;
    renderSidebar();
    if (activeFriendId === friendId) updateChatStreakBadge();
  });

  socket.on('plus:updated', ({ plusUntil, reason, streak }) => {
    me.plusUntil = plusUntil;
    me.plusActive = !!(plusUntil && new Date(plusUntil).getTime() > Date.now());
    applyMeUI();
    if (reason === 'streak') {
      toast(`🎉 ${streak} günlük streak! 1 haftalık Snoop Plus kazandınız!`);
    } else if (me.plusActive) {
      toast('✨ Snoop Plus üyeliğin güncellendi!');
    } else {
      toast('Snoop Plus üyeliğin sona erdi.');
    }
  });

  socket.on('game:invited', (data) => {
    incomingInvite = data;
    const label = SnoopGames.multiplayerGames.find((g) => g.id === data.gameType);
    $('game-invite-text').textContent = `${data.from.displayName} seni "${label ? label.label : data.gameType}" (${data.difficulty}) oyununa davet etti!`;
    $('game-invite-overlay').classList.remove('hidden');
  });

  socket.on('game:declined', () => {
    $('game-waiting-overlay').classList.add('hidden');
    pendingInviteId = null;
    toast('Davetin reddedildi.');
  });

  socket.on('game:start', (payload) => {
    $('game-waiting-overlay').classList.add('hidden');
    $('game-invite-overlay').classList.add('hidden');
    pendingInviteId = null;
    incomingInvite = null;
    activeGameSessionId = payload.sessionId;
    if (activeGameCleanup) { activeGameCleanup(); activeGameCleanup = null; }
    const label = SnoopGames.multiplayerGames.find((g) => g.id === payload.gameType);
    $('game-active-title').textContent = `${label ? label.label : payload.gameType} • ${payload.difficulty}`;
    $('game-active-overlay').classList.remove('hidden');
    renderActiveMultiplayerGame(payload);
  });

  socket.on('game:state', (payload) => {
    if (payload.sessionId !== activeGameSessionId) return;
    renderActiveMultiplayerGame(payload);
  });

  socket.on('game:over', ({ sessionId, winnerId }) => {
    if (sessionId !== activeGameSessionId) return;
    toast(winnerId === me.id ? '🏆 Oyunu kazandın!' : winnerId ? 'Oyunu kaybettin.' : 'Oyun berabere bitti.');
  });

  socket.on('game:opponent-left', ({ sessionId }) => {
    if (sessionId !== activeGameSessionId) return;
    toast('Rakibin oyundan ayrıldı.');
    closeActiveGame(false);
  });
}

function friendNameById(id) {
  const f = friendsData.accepted.find((x) => x.id === id);
  return f ? f.displayName : 'Biri';
}

/* ---------- Friends / sidebar ---------- */

async function loadFriends() {
  friendsData = await getJSON('/api/friends');
}

async function loadInbox() {
  const { messages } = await getJSON('/api/inbox');
  inboxByFriend = new Map();
  for (const m of messages) {
    const friendId = m.senderId === me.id ? m.receiverId : m.senderId;
    inboxByFriend.set(friendId, m);
  }
}

function renderSidebar() {
  const reqSection = $('requests-section');
  const reqList = $('requests-list');
  reqList.innerHTML = '';
  if (friendsData.incoming.length) {
    reqSection.classList.remove('hidden');
    for (const u of friendsData.incoming) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        ${avatarHtml(u)}
        <div class="name-block"><div class="n">${escapeHtml(u.displayName)}</div><div class="u">@${escapeHtml(u.username)}</div></div>
        <button class="pill-btn accept">Kabul et</button>
        <button class="pill-btn decline">Reddet</button>
      `;
      row.querySelector('.accept').addEventListener('click', () => respondFriend(u.id, true));
      row.querySelector('.decline').addEventListener('click', () => respondFriend(u.id, false));
      reqList.appendChild(row);
    }
  } else {
    reqSection.classList.add('hidden');
  }

  const list = $('friend-list');
  list.innerHTML = '';
  const rows = friendsData.accepted.slice().sort((a, b) => {
    const ma = inboxByFriend.get(a.id);
    const mb = inboxByFriend.get(b.id);
    const ta = ma ? new Date(ma.createdAt + 'Z').getTime() : 0;
    const tb = mb ? new Date(mb.createdAt + 'Z').getTime() : 0;
    return tb - ta;
  });

  if (!rows.length && !friendsData.outgoing.length) {
    list.innerHTML = '<p class="empty-hint">Henüz arkadaşın yok. Yukarıdan kullanıcı adıyla ara ve ekle!</p>';
  }

  for (const f of rows) {
    const lastMsg = inboxByFriend.get(f.id);
    const row = document.createElement('div');
    row.className = 'friend-row' + (activeFriendId === f.id ? ' active' : '');
    let previewText = 'Sohbete başla 🔍';
    let unread = false;
    if (lastMsg) {
      if (lastMsg.type === 'snap') {
        previewText = lastMsg.senderId === me.id ? '📷 Snap gönderdin' : (lastMsg.viewedAt ? '📷 Snap görüntülendi' : '📷 Yeni Snap');
      } else {
        previewText = (lastMsg.senderId === me.id ? 'Sen: ' : '') + lastMsg.content;
      }
      const t = new Date(lastMsg.createdAt + 'Z').getTime();
      unread = lastMsg.senderId !== me.id && t > getLastRead(f.id);
    }
    const streakHtml = f.streak > 0 ? `<span class="streak-badge">🔥${f.streak}</span>` : '';
    const bestHtml = f.isBestFriend ? ' ⭐' : '';
    const plusHtml = f.plusActive ? ' <span class="plus-badge">✨</span>' : '';
    row.innerHTML = `
      ${avatarHtml(f)}
      <div class="name-block">
        <div class="n">${escapeHtml(f.displayName)}${bestHtml}${plusHtml}${streakHtml}</div>
        <div class="preview${unread ? ' unread' : ''}">${escapeHtml(previewText)}</div>
      </div>
      <div class="time">${lastMsg ? timeLabel(lastMsg.createdAt) : ''}</div>
    `;
    row.addEventListener('click', () => openConversation(f.id));
    list.appendChild(row);
  }

  for (const f of friendsData.outgoing) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      ${avatarHtml(f)}
      <div class="name-block"><div class="n">${escapeHtml(f.displayName)}</div><div class="u">İstek gönderildi</div></div>
    `;
    list.appendChild(row);
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
}

async function respondFriend(otherId, accept) {
  await postJSON(`/api/friends/${otherId}/respond`, { accept });
  await loadFriends();
  renderSidebar();
}

/* ---------- Search ---------- */

let searchDebounce = null;
function bindSearch() {
  const input = $('search-input');
  const results = $('search-results');
  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q) { results.classList.add('hidden'); results.innerHTML = ''; return; }
    searchDebounce = setTimeout(async () => {
      const { users } = await getJSON(`/api/users/search?q=${encodeURIComponent(q)}`);
      results.innerHTML = '';
      if (!users.length) {
        results.innerHTML = '<p class="empty-hint">Kullanıcı bulunamadı</p>';
      } else {
        for (const u of users) {
          const isFriend = friendsData.accepted.some((f) => f.id === u.id);
          const isOutgoing = friendsData.outgoing.some((f) => f.id === u.id);
          const isIncoming = friendsData.incoming.some((f) => f.id === u.id);
          const row = document.createElement('div');
          row.className = 'list-row';
          let btnHtml = '<button class="pill-btn add">Ekle</button>';
          if (isFriend) btnHtml = '<span class="u">Arkadaşsınız</span>';
          else if (isOutgoing) btnHtml = '<span class="u">İstek gönderildi</span>';
          else if (isIncoming) btnHtml = '<span class="u">İstek bekliyor</span>';
          row.innerHTML = `
            ${avatarHtml(u)}
            <div class="name-block"><div class="n">${escapeHtml(u.displayName)}</div><div class="u">@${escapeHtml(u.username)}</div></div>
            ${btnHtml}
          `;
          const addBtn = row.querySelector('.add');
          if (addBtn) {
            addBtn.addEventListener('click', async () => {
              addBtn.disabled = true;
              try {
                await postJSON('/api/friends/request', { username: u.username });
                toast('Arkadaşlık isteği gönderildi');
                await loadFriends();
                renderSidebar();
                addBtn.outerHTML = '<span class="u">İstek gönderildi</span>';
              } catch (e) { toast(e.message); addBtn.disabled = false; }
            });
          }
          results.appendChild(row);
        }
      }
      results.classList.remove('hidden');
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
  });
}

/* ---------- Conversation ---------- */

async function openConversation(friendId) {
  activeFriendId = friendId;
  replyingTo = null;
  updateReplyBanner();
  setLastRead(friendId);

  const f = friendsData.accepted.find((x) => x.id === friendId);
  paintAvatar($('chat-avatar'), f);
  $('chat-name').textContent = f.displayName;
  $('chat-username').textContent = '@' + f.username;

  $('chat-placeholder').classList.add('hidden');
  $('chat-active').classList.remove('hidden');
  $('chat-panel').classList.add('open');
  $('sidebar').classList.add('chat-open');

  updateChatStreakBadge();
  updateBestFriendButton();
  applyChatBackground();

  if (!messagesByFriend.has(friendId)) {
    const { messages } = await getJSON(`/api/messages/${friendId}`);
    messagesByFriend.set(friendId, messages);
  }
  renderMessages(messagesByFriend.get(friendId));
  renderSidebar();
}

function updateChatStreakBadge() {
  const existing = document.getElementById('chat-streak-badge');
  if (existing) existing.remove();
  const f = friendsData.accepted.find((x) => x.id === activeFriendId);
  if (f && f.streak > 0) {
    const badge = document.createElement('span');
    badge.id = 'chat-streak-badge';
    badge.className = 'streak-badge';
    badge.textContent = `🔥${f.streak}`;
    $('chat-name').appendChild(badge);
  }
}

function updateBestFriendButton() {
  const btn = $('best-friend-btn');
  const isBest = me.bestFriendId === activeFriendId;
  btn.textContent = isBest ? '★' : '☆';
  btn.classList.toggle('active', isBest);
  // Never use the native `disabled` attribute here: it would silently swallow the click
  // before toggleBestFriend() gets a chance to re-check fresh Plus status from the server.
  btn.classList.toggle('dim', !me.plusActive);
  btn.title = me.plusActive ? 'En sevdiğim arkadaş' : 'En sevdiğim arkadaş seçimi Plus üyelere özel';
}

function applyChatBackground() {
  const box = $('messages');
  box.className = 'messages';
  // CSS rules are .messages.bg-<name> — the stored value has no "bg-" prefix, so it must
  // be added here (this mismatch was the bug: the class was applied but never matched any rule).
  if (me.chatBackground) box.classList.add('bg-' + me.chatBackground);
}

function closeConversation() {
  activeFriendId = null;
  $('chat-panel').classList.remove('open');
  $('sidebar').classList.remove('chat-open');
}

function renderMessages(list) {
  const box = $('messages');
  box.innerHTML = '';
  for (const m of list) appendMessageDOM(m, false);
  scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function findMessageById(id) {
  for (const arr of messagesByFriend.values()) {
    const m = arr.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

// Adds msg to the friend's message list if it isn't already there (a message can arrive
// both via the socket echo and the HTTP response for the tab that sent it). Returns true
// if it was newly added.
function addMessageIfNew(friendId, msg) {
  const arr = messagesByFriend.get(friendId);
  if (!arr) return false; // conversation not loaded yet; nothing to dedupe into
  if (arr.some((x) => x.id === msg.id)) return false;
  arr.push(msg);
  return true;
}

function quoteLabel(msg) {
  if (!msg) return 'Mesaj';
  if (msg.type === 'snap') return '📷 Snap';
  return msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content;
}

function appendMessageDOM(msg, scroll = true) {
  const box = $('messages');
  const row = document.createElement('div');
  row.className = 'msg-row ' + (msg.senderId === me.id ? 'own' : 'other');
  row.dataset.msgId = msg.id;

  if (msg.replyToId) {
    const parent = findMessageById(msg.replyToId);
    const quote = document.createElement('div');
    quote.className = 'msg-reply-quote';
    quote.textContent = '↩ ' + quoteLabel(parent);
    row.appendChild(quote);
  }

  if (msg.type === 'text') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.content;
    row.appendChild(bubble);
  } else {
    const card = document.createElement('button');
    card.className = 'snap-card';
    row.appendChild(card);
    updateSnapCardEl(row, msg);
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = timeLabel(msg.createdAt);
  row.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const replyBtn = document.createElement('button');
  replyBtn.textContent = '↩ Yanıtla';
  replyBtn.addEventListener('click', () => startReply(msg));
  actions.appendChild(replyBtn);
  row.appendChild(actions);

  box.appendChild(row);
  if (scroll) scrollMessagesToBottom();
}

function updateSnapCardEl(row, msgArg) {
  const msg = msgArg || findMessageById(Number(row.dataset.msgId));
  if (!msg) return;
  const card = row.querySelector('.snap-card');
  if (!card) return;
  const isOwn = msg.senderId === me.id;
  card.className = 'snap-card';
  const cachedImg = localImageCache.get(msg.id);

  if (isOwn) {
    if (msg.viewedAt) {
      card.classList.add('opened');
      card.textContent = '📷 Snap • Görüntülendi';
    } else {
      card.classList.add('pending');
      card.textContent = cachedImg ? '📷 Snap • Gönderildi (dokun, önizle)' : '📷 Snap • Gönderildi';
    }
    card.onclick = cachedImg ? () => openSnapViewer(cachedImg, msg.caption) : null;
  } else if (msg.viewedAt) {
    card.classList.add('opened');
    card.textContent = '📷 Snap • Açıldı';
    card.onclick = null;
  } else {
    card.textContent = '📷 Görüntülemek için dokun';
    card.onclick = () => viewSnap(msg);
  }
}

function startReply(msg) {
  replyingTo = msg;
  updateReplyBanner();
  $('text-input').focus();
}

function updateReplyBanner() {
  const banner = $('reply-banner');
  if (!replyingTo) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const who = replyingTo.senderId === me.id ? 'Kendine' : friendNameById(replyingTo.senderId);
  $('reply-banner-content').innerHTML = `<b>${escapeHtml(who)}</b> — ${escapeHtml(quoteLabel(replyingTo))}`;
}

/* ---------- Sending text ---------- */

async function sendText() {
  const input = $('text-input');
  const content = input.value.trim();
  if (!content || !activeFriendId) return;
  input.value = '';
  $('send-text-btn').disabled = true;
  try {
    const { message } = await postJSON('/api/messages', {
      receiverId: activeFriendId,
      type: 'text',
      content,
      replyToId: replyingTo ? replyingTo.id : null,
    });
    const isNew = addMessageIfNew(activeFriendId, message);
    inboxByFriend.set(activeFriendId, message);
    if (isNew) appendMessageDOM(message);
    replyingTo = null;
    updateReplyBanner();
    renderSidebar();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Snap viewing ---------- */

async function viewSnap(msg) {
  try {
    const { message } = await postJSON(`/api/messages/${msg.id}/view`);
    msg.viewedAt = message.viewedAt;
    msg.hasImage = false;
    const row = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (row) updateSnapCardEl(row, msg);
    openSnapViewer(message.imageData, message.caption);
  } catch (e) {
    toast(e.message);
  }
}

function openSnapViewer(imageData, caption) {
  const viewer = $('snap-viewer');
  $('viewer-image').src = imageData;
  const capEl = $('viewer-caption');
  if (caption) { capEl.textContent = caption; capEl.classList.remove('hidden'); }
  else { capEl.classList.add('hidden'); }
  viewer.classList.remove('hidden');

  const fill = $('viewer-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  void fill.offsetWidth;
  const DURATION = 8000;
  fill.style.transition = `width ${DURATION}ms linear`;
  fill.style.width = '0%';

  clearTimeout(pendingViewerTimer);
  pendingViewerTimer = setTimeout(closeSnapViewer, DURATION);
}

function closeSnapViewer() {
  clearTimeout(pendingViewerTimer);
  $('snap-viewer').classList.add('hidden');
  $('viewer-image').src = '';
}

/* ---------- Camera ---------- */

function renderFilterStrip() {
  const strip = $('filter-strip');
  strip.innerHTML = '';
  for (const f of SnapFilters.list) {
    const locked = f.plus && !me.plusActive;
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (f.id === currentFilterId ? ' active' : '') + (locked ? ' locked' : '');
    chip.textContent = f.emoji;
    chip.title = locked ? `${f.label} — Snoop Plus'a özel` : f.label;
    if (locked) {
      const badge = document.createElement('span');
      badge.className = 'filter-lock-badge';
      badge.textContent = '🔒';
      chip.appendChild(badge);
    }
    chip.addEventListener('click', async () => {
      if (locked) {
        await refreshMe();
        if (f.plus && !me.plusActive) {
          openPricing(`${f.label} filtresi Snoop Plus'a özel.`);
          return;
        }
        renderFilterStrip(); // plus turned out to be active after refresh; redraw unlocked
      }
      currentFilterId = f.id;
      strip.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      const freshChip = strip.querySelector(`[data-filter-id="${f.id}"]`);
      (freshChip || chip).classList.add('active');
    });
    chip.dataset.filterId = f.id;
    strip.appendChild(chip);
  }
  strip.classList.remove('hidden');
}

async function openCamera() {
  $('camera-overlay').classList.remove('hidden');
  $('camera-permission').classList.remove('hidden');
  $('camera-video').classList.add('hidden');
  $('camera-canvas').classList.add('hidden');
  $('captured-image').classList.add('hidden');
  $('snap-caption').classList.add('hidden');
  $('snap-caption').value = '';
  $('shutter-controls').classList.remove('hidden');
  $('preview-controls').classList.add('hidden');
  $('filter-strip').classList.add('hidden');
  $('camera-error').textContent = '';
  capturedDataUrl = null;
  currentFilterId = 'none';
  resetSaveGalleryButton();
  refreshMe(); // don't block camera opening on this; filter strip re-renders once it lands

  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' }).then((status) => {
      if (status.state === 'granted') requestCamera();
    }).catch(() => {});
  }
}

async function requestCamera() {
  $('camera-error').textContent = '';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
      audio: false,
    });
    $('camera-permission').classList.add('hidden');
    const video = $('camera-video');
    const canvas = $('camera-canvas');
    video.srcObject = cameraStream;
    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      video.onloadedmetadata = () => resolve();
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.classList.remove('hidden');
    $('switch-camera-btn').classList.remove('hidden');

    SnapFilters.start(video, canvas, {
      getFilterId: () => currentFilterId,
      getFacingMode: () => currentFacingMode,
    });
    renderFilterStrip();
    if (!SnapFilters.isLoaded()) {
      $('filter-loading').classList.remove('hidden');
      SnapFilters.loadModels()
        .then(() => toast('Filtreler hazır ✅ Bir filtre seç ve yüzünü kameraya göster.'))
        .catch((err) => {
          console.error('Filter model load failed:', err);
          toast('Filtreler yüklenemedi (ağ bağlantısı sorunu). Kamera yine çalışır.');
        })
        .finally(() => $('filter-loading').classList.add('hidden'));
    }
  } catch (err) {
    $('camera-error').textContent = 'Kamera izni reddedildi veya kamera bulunamadı. Tarayıcı ayarlarından izin verip tekrar dene.';
  }
}

function stopCamera() {
  SnapFilters.stop();
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

function closeCamera() {
  stopCamera();
  $('camera-overlay').classList.add('hidden');
  $('switch-camera-btn').classList.add('hidden');
}

function captureSnap() {
  const canvas = $('camera-canvas');
  if (!canvas.width) return;
  capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

  canvas.classList.add('hidden');
  stopCamera();
  const img = $('captured-image');
  img.src = capturedDataUrl;
  img.classList.remove('hidden');
  $('snap-caption').classList.remove('hidden');
  $('shutter-controls').classList.add('hidden');
  $('preview-controls').classList.remove('hidden');
  $('filter-strip').classList.add('hidden');
  $('switch-camera-btn').classList.add('hidden');
  resetSaveGalleryButton();
}

function retakeSnap() {
  capturedDataUrl = null;
  $('captured-image').classList.add('hidden');
  $('snap-caption').classList.add('hidden');
  $('preview-controls').classList.add('hidden');
  $('shutter-controls').classList.remove('hidden');
  resetSaveGalleryButton();
  requestCamera();
}

function resetSaveGalleryButton() {
  const btn = $('save-gallery-btn');
  btn.disabled = false;
  btn.classList.remove('saved');
  btn.textContent = '💾';
}

async function saveToGallery() {
  if (!capturedDataUrl) return;
  const btn = $('save-gallery-btn');
  btn.disabled = true;
  try {
    const caption = $('snap-caption').value.trim();
    await postJSON('/api/gallery', { imageData: capturedDataUrl, caption });
    btn.classList.add('saved');
    btn.textContent = '✅';
    toast('Galerine kaydedildi');
  } catch (e) {
    btn.disabled = false;
    toast(e.message);
  }
}

async function sendSnap() {
  if (!capturedDataUrl || !activeFriendId) return;
  const btn = $('send-snap-btn');
  btn.disabled = true;
  const caption = $('snap-caption').value.trim();
  await sendSnapImage(capturedDataUrl, caption);
  btn.disabled = false;
  closeCamera();
}

/* ---------- Best friend / chat background (Plus) ---------- */

// The in-memory `me` object can be stale if Plus was granted from another tab/device
// (e.g. via the admin panel) without reloading this one — re-check with the server
// before trusting a cached "not Plus" state.
async function refreshMe() {
  const { user } = await getJSON('/api/auth/me');
  if (user) { me = user; applyMeUI(); }
  return me;
}

async function toggleBestFriend() {
  await refreshMe();
  if (!me.plusActive) { openPricing('En sevdiğim arkadaş seçimi Snoop Plus üyelerine özel.'); return; }
  if (!activeFriendId) return;
  const isBest = me.bestFriendId === activeFriendId;
  const newId = isBest ? null : activeFriendId;
  try {
    const { user } = await postJSON('/api/profile/best-friend', { friendId: newId });
    me.bestFriendId = user.bestFriendId;
    updateBestFriendButton();
    await loadFriends();
    renderSidebar();
    toast(isBest ? 'En sevdiğin arkadaş kaldırıldı.' : 'En sevdiğin arkadaş olarak ayarlandı ⭐');
  } catch (e) {
    toast(e.message);
  }
}

async function openBgPicker() {
  await refreshMe();
  if (!me.plusActive) { openPricing('Sohbet arka planları Snoop Plus üyelerine özel.'); return; }
  if (!chatBackgrounds.length) {
    const { backgrounds } = await getJSON('/api/profile/chat-backgrounds');
    chatBackgrounds = backgrounds;
  }
  const grid = $('bg-swatches');
  grid.innerHTML = '';
  const noneSwatch = document.createElement('div');
  noneSwatch.className = 'bg-swatch none' + (!me.chatBackground ? ' selected' : '');
  noneSwatch.textContent = 'Yok';
  noneSwatch.addEventListener('click', () => chooseBackground(null));
  grid.appendChild(noneSwatch);
  for (const bg of chatBackgrounds) {
    const el = document.createElement('div');
    el.className = `bg-swatch bg-${bg}` + (me.chatBackground === bg ? ' selected' : '');
    el.addEventListener('click', () => chooseBackground(bg));
    grid.appendChild(el);
  }
  $('bg-picker-overlay').classList.remove('hidden');
}

async function chooseBackground(bg) {
  try {
    const { user } = await postJSON('/api/profile/chat-background', { background: bg });
    me.chatBackground = user.chatBackground;
    applyChatBackground();
    $('bg-picker-overlay').classList.add('hidden');
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Avatar designer ---------- */

let avatarDraft = null;
let avatarTab = SnoopAvatar.CATEGORIES[0].key;

async function openAvatarEditor() {
  await refreshMe();
  avatarDraft = { ...SnoopAvatar.DEFAULT, ...(me.avatarConfig || {}) };
  renderAvatarTabs();
  renderAvatarEditor();
  $('avatar-overlay').classList.remove('hidden');
}

function renderAvatarTabs() {
  const tabs = $('avatar-tabs');
  tabs.innerHTML = '';
  for (const cat of SnoopAvatar.CATEGORIES) {
    const b = document.createElement('button');
    b.className = 'avatar-tab' + (cat.key === avatarTab ? ' active' : '');
    b.textContent = cat.label;
    b.addEventListener('click', () => {
      avatarTab = cat.key;
      renderAvatarTabs();
      renderAvatarEditor();
      $('avatar-options').scrollTop = 0;
    });
    tabs.appendChild(b);
  }
}

function draftUsesPlus() {
  return SnoopAvatar.sanitize(avatarDraft).plusUsed.length > 0;
}

function renderAvatarEditor() {
  $('avatar-preview').innerHTML = SnoopAvatar.render(avatarDraft);
  $('avatar-plus-note').classList.toggle('hidden', me.plusActive || !draftUsesPlus());

  const cat = SnoopAvatar.CATEGORIES.find((c) => c.key === avatarTab);
  const grid = $('avatar-options');
  grid.innerHTML = '';
  // Plus-only items last for free users, so the free wardrobe comes first.
  const options = me.plusActive ? cat.options : [...cat.options.filter((o) => !o.plus), ...cat.options.filter((o) => o.plus)];
  for (const opt of options) {
    const tile = document.createElement('button');
    tile.className = 'avatar-option' + (avatarDraft[cat.key] === opt.id ? ' selected' : '') + (opt.plus ? ' plus' : '');
    tile.dataset.optionId = opt.id;
    tile.title = opt.label;
    tile.innerHTML = `<div class="avatar-option-img">${SnoopAvatar.render({ ...avatarDraft, [cat.key]: opt.id })}</div>`
      + `<div class="avatar-option-label">${escapeHtml(opt.label)}</div>`
      + (opt.plus ? `<span class="avatar-option-badge">${me.plusActive ? '✨' : '🔒'}</span>` : '');
    tile.addEventListener('click', () => {
      avatarDraft[cat.key] = opt.id;
      renderAvatarEditor();
    });
    grid.appendChild(tile);
  }
}

async function saveAvatar() {
  await refreshMe();
  if (!me.plusActive && draftUsesPlus()) {
    const locked = SnoopAvatar.sanitize(avatarDraft).plusUsed.join(', ');
    openPricing(`${locked} Snoop Plus'a özel.`);
    return;
  }
  try {
    const { user } = await postJSON('/api/profile/avatar', { config: avatarDraft });
    me = user;
    applyMeUI();
    $('avatar-overlay').classList.add('hidden');
    toast('Avatarın kaydedildi 😎');
  } catch (e) {
    if (e.status === 403) openPricing(e.message);
    else toast(e.message);
  }
}

/* ---------- Snoop Plus pricing ---------- */

async function openPricing(reason) {
  const reasonEl = $('pricing-reason');
  reasonEl.textContent = reason ? `🔒 ${reason}` : '';
  reasonEl.classList.toggle('hidden', !reason);
  $('pricing-overlay').classList.remove('hidden');
  await refreshMe().catch(() => {});
  const status = $('pricing-status');
  if (me.plusActive && me.plusUntil) {
    const until = new Date(me.plusUntil).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    status.textContent = `✅ Plus üyesisin — ${until} tarihine kadar`;
    status.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }
}

/* ---------- Games ---------- */

function buildGameRow(g, isMultiplayer) {
  const row = document.createElement('div');
  row.className = 'game-row';
  row.innerHTML = `
    <div class="icon">${g.emoji}</div>
    <div class="info"><div class="n">${escapeHtml(g.label)}</div><div class="tag">${isMultiplayer ? 'Arkadaşınla, gerçek zamanlı' : 'Tek kişilik'}</div></div>
    <div class="diffs">
      <button class="diff-btn kolay" data-diff="kolay">Kolay</button>
      <button class="diff-btn orta" data-diff="orta">Orta</button>
      <button class="diff-btn zor" data-diff="zor">Zor</button>
    </div>
  `;
  row.querySelectorAll('[data-diff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('game-picker-overlay').classList.add('hidden');
      if (isMultiplayer) startMultiplayerInvite(g.id, btn.dataset.diff);
      else startSoloGame(g.id, g.label, btn.dataset.diff);
    });
  });
  return row;
}

function openGamePicker() {
  const list = $('game-list');
  list.innerHTML = '';

  const soloHeader = document.createElement('div');
  soloHeader.className = 'section-label';
  soloHeader.style.padding = '4px 0';
  soloHeader.textContent = 'Tek Kişilik';
  list.appendChild(soloHeader);
  for (const g of SnoopGames.soloGames) list.appendChild(buildGameRow(g, false));

  const mpHeader = document.createElement('div');
  mpHeader.className = 'section-label';
  mpHeader.style.padding = '12px 0 4px';
  mpHeader.textContent = 'Arkadaşınla (Gerçek Zamanlı)';
  list.appendChild(mpHeader);
  for (const g of SnoopGames.multiplayerGames) list.appendChild(buildGameRow(g, true));

  $('game-picker-overlay').classList.remove('hidden');
}

function startSoloGame(gameId, label, difficulty) {
  $('game-active-title').textContent = `${label} • ${difficulty}`;
  const body = $('game-active-body');
  body.innerHTML = '';
  $('game-active-overlay').classList.remove('hidden');
  if (activeGameCleanup) activeGameCleanup();
  activeGameSessionId = null;
  activeGameCleanup = SnoopGames.runSolo(gameId, body, difficulty, {
    onScore: (score) => showSoloResult(label, score),
  });
}

function showSoloResult(label, score) {
  const body = $('game-active-body');
  const banner = document.createElement('div');
  banner.className = 'game-result-banner';
  banner.textContent = `Bitti! Skor: ${score}`;
  body.appendChild(banner);
  if (activeFriendId) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'primary-btn';
    shareBtn.textContent = 'Skoru arkadaşına gönder';
    shareBtn.addEventListener('click', async () => {
      try {
        await postJSON('/api/messages', {
          receiverId: activeFriendId,
          type: 'text',
          content: `🎮 ${label}'de ${score} skor yaptım!`,
        });
        toast('Skor gönderildi!');
      } catch (e) {
        toast(e.message);
      }
    });
    body.appendChild(shareBtn);
  }
}

function startMultiplayerInvite(gameId, difficulty) {
  if (!activeFriendId) { toast('Önce bir arkadaşınla sohbet aç.'); return; }
  const friend = friendsData.accepted.find((f) => f.id === activeFriendId);
  $('game-waiting-text').textContent = `${friend ? friend.displayName : 'Arkadaşın'}a davet gönderildi, bekleniyor…`;
  $('game-waiting-overlay').classList.remove('hidden');
  socket.emit('game:invite', { toFriendId: activeFriendId, gameType: gameId, difficulty }, (res) => {
    if (!res.ok) {
      $('game-waiting-overlay').classList.add('hidden');
      toast(res.error);
      pendingInviteId = null;
    } else {
      pendingInviteId = res.inviteId;
    }
  });
}

function respondToInvite(accept) {
  if (!incomingInvite) return;
  $('game-invite-overlay').classList.add('hidden');
  socket.emit('game:respond', { inviteId: incomingInvite.inviteId, accept }, (res) => {
    if (!res.ok) toast(res.error);
  });
  incomingInvite = null;
}

function renderActiveMultiplayerGame(payload) {
  const body = $('game-active-body');
  SnoopGames.renderMultiplayer(payload.gameType, body, payload.state, me.id, (move) => {
    socket.emit('game:move', { sessionId: activeGameSessionId, move }, (res) => {
      if (!res.ok) toast(res.error);
    });
  });
}

function closeActiveGame(notifyServer) {
  if (notifyServer && activeGameSessionId) {
    socket.emit('game:leave', { sessionId: activeGameSessionId });
  }
  if (activeGameCleanup) { activeGameCleanup(); activeGameCleanup = null; }
  activeGameSessionId = null;
  $('game-active-overlay').classList.add('hidden');
  $('game-active-body').innerHTML = '';
}

/* ---------- Upload photo from gallery ---------- */

function handleUploadPhoto(file) {
  if (!file || !activeFriendId) return;
  const reader = new FileReader();
  reader.onload = () => sendSnapImage(reader.result, '');
  reader.readAsDataURL(file);
}

/* ---------- Gallery (private Memories) ---------- */

let galleryItems = [];

async function openGallery() {
  $('gallery-overlay').classList.remove('hidden');
  try {
    const { items } = await getJSON('/api/gallery');
    galleryItems = items;
    renderGalleryGrid();
  } catch (e) {
    toast(e.message);
  }
}

function renderGalleryGrid() {
  const grid = $('gallery-grid');
  grid.innerHTML = '';
  $('gallery-empty-hint').classList.toggle('hidden', galleryItems.length > 0);
  for (const item of galleryItems) {
    const img = document.createElement('img');
    img.src = item.imageData;
    img.loading = 'lazy';
    img.addEventListener('click', () => openGalleryViewer(item));
    grid.appendChild(img);
  }
}

function openGalleryViewer(item) {
  $('gallery-viewer').dataset.itemId = item.id;
  $('gallery-viewer-image').src = item.imageData;
  $('gallery-viewer').classList.remove('hidden');
}

function closeGalleryViewer() {
  $('gallery-viewer').classList.add('hidden');
  $('gallery-viewer-image').src = '';
}

async function deleteCurrentGalleryItem() {
  const id = Number($('gallery-viewer').dataset.itemId);
  if (!id) return;
  try {
    const res = await fetch(`/api/gallery/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Silinemedi, tekrar dene.');
    galleryItems = galleryItems.filter((it) => it.id !== id);
    renderGalleryGrid();
    closeGalleryViewer();
    toast('Fotoğraf silindi');
  } catch (e) {
    toast(e.message);
  }
}

async function sendSnapImage(dataUrl, caption) {
  if (!dataUrl || !activeFriendId) return;
  try {
    const { message } = await postJSON('/api/messages', {
      receiverId: activeFriendId,
      type: 'snap',
      imageData: dataUrl,
      caption,
      replyToId: replyingTo ? replyingTo.id : null,
    });
    localImageCache.set(message.id, dataUrl);
    message.hasImage = true;
    const isNew = addMessageIfNew(activeFriendId, message);
    inboxByFriend.set(activeFriendId, message);
    if (isNew) {
      appendMessageDOM(message);
    } else {
      const row = document.querySelector(`[data-msg-id="${message.id}"]`);
      if (row) updateSnapCardEl(row, message);
    }
    replyingTo = null;
    updateReplyBanner();
    renderSidebar();
  } catch (e) {
    toast(e.message);
  }
}

function switchCamera() {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  stopCamera();
  requestCamera();
}

/* ---------- UI bindings ---------- */

function bindUI() {
  bindSearch();

  $('logout-btn').addEventListener('click', async () => {
    await postJSON('/api/auth/logout');
    window.location.href = '/index.html';
  });

  $('back-btn').addEventListener('click', closeConversation);

  $('text-input').addEventListener('input', () => {
    $('send-text-btn').disabled = !$('text-input').value.trim();
  });
  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendText(); }
  });
  $('send-text-btn').addEventListener('click', sendText);
  $('reply-cancel-btn').addEventListener('click', () => { replyingTo = null; updateReplyBanner(); });

  $('open-camera-btn').addEventListener('click', openCamera);
  $('close-camera-btn').addEventListener('click', closeCamera);
  $('request-camera-btn').addEventListener('click', requestCamera);
  $('shutter-btn').addEventListener('click', captureSnap);
  $('retake-btn').addEventListener('click', retakeSnap);
  $('send-snap-btn').addEventListener('click', sendSnap);
  $('switch-camera-btn').addEventListener('click', switchCamera);

  $('viewer-close-btn').addEventListener('click', closeSnapViewer);

  $('admin-link-btn').addEventListener('click', () => { window.location.href = '/admin.html'; });
  $('best-friend-btn').addEventListener('click', toggleBestFriend);
  $('bg-picker-btn').addEventListener('click', openBgPicker);
  $('bg-picker-close-btn').addEventListener('click', () => $('bg-picker-overlay').classList.add('hidden'));

  $('upload-photo-btn').addEventListener('click', () => $('upload-photo-input').click());
  $('upload-photo-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleUploadPhoto(file);
    e.target.value = '';
  });

  $('open-games-btn').addEventListener('click', openGamePicker);
  $('game-picker-close-btn').addEventListener('click', () => $('game-picker-overlay').classList.add('hidden'));
  $('game-invite-accept-btn').addEventListener('click', () => respondToInvite(true));
  $('game-invite-decline-btn').addEventListener('click', () => respondToInvite(false));
  $('game-waiting-cancel-btn').addEventListener('click', () => {
    $('game-waiting-overlay').classList.add('hidden');
    if (pendingInviteId) socket.emit('game:invite-cancel', { inviteId: pendingInviteId });
    pendingInviteId = null;
  });
  $('game-active-close-btn').addEventListener('click', () => closeActiveGame(true));

  $('my-avatar').addEventListener('click', openAvatarEditor);
  $('avatar-close-btn').addEventListener('click', () => $('avatar-overlay').classList.add('hidden'));
  $('avatar-random-btn').addEventListener('click', () => {
    avatarDraft = SnoopAvatar.randomConfig(me.plusActive);
    renderAvatarEditor();
  });
  $('avatar-save-btn').addEventListener('click', saveAvatar);
  $('pricing-btn').addEventListener('click', () => openPricing());
  $('pricing-close-btn').addEventListener('click', () => $('pricing-overlay').classList.add('hidden'));

  $('save-gallery-btn').addEventListener('click', saveToGallery);
  $('gallery-btn').addEventListener('click', openGallery);
  $('gallery-close-btn').addEventListener('click', () => $('gallery-overlay').classList.add('hidden'));
  $('gallery-viewer-close-btn').addEventListener('click', closeGalleryViewer);
  $('gallery-viewer-delete-btn').addEventListener('click', deleteCurrentGalleryItem);
}

init();
