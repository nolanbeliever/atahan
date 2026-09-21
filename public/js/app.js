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
  $('my-name').textContent = me.displayName;
  $('my-username').textContent = '@' + me.username;
  const av = $('my-avatar');
  av.style.background = me.avatarColor;
  av.textContent = initials(me.displayName);

  connectSocket();
  bindUI();
  await Promise.all([loadFriends(), loadInbox()]);
  renderSidebar();
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
        <div class="avatar sm" style="background:${u.avatarColor}">${initials(u.displayName)}</div>
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
    let previewText = 'Sohbete başla 👻';
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
    row.innerHTML = `
      <div class="avatar sm" style="background:${f.avatarColor}">${initials(f.displayName)}</div>
      <div class="name-block">
        <div class="n">${escapeHtml(f.displayName)}</div>
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
      <div class="avatar sm" style="background:${f.avatarColor}">${initials(f.displayName)}</div>
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
            <div class="avatar sm" style="background:${u.avatarColor}">${initials(u.displayName)}</div>
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
  $('chat-avatar').style.background = f.avatarColor;
  $('chat-avatar').textContent = initials(f.displayName);
  $('chat-name').textContent = f.displayName;
  $('chat-username').textContent = '@' + f.username;

  $('chat-placeholder').classList.add('hidden');
  $('chat-active').classList.remove('hidden');
  $('chat-panel').classList.add('open');
  $('sidebar').classList.add('chat-open');

  if (!messagesByFriend.has(friendId)) {
    const { messages } = await getJSON(`/api/messages/${friendId}`);
    messagesByFriend.set(friendId, messages);
  }
  renderMessages(messagesByFriend.get(friendId));
  renderSidebar();
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

function openCamera() {
  $('camera-overlay').classList.remove('hidden');
  $('camera-permission').classList.remove('hidden');
  $('camera-video').classList.add('hidden');
  $('captured-image').classList.add('hidden');
  $('snap-caption').classList.add('hidden');
  $('snap-caption').value = '';
  $('shutter-controls').classList.remove('hidden');
  $('preview-controls').classList.add('hidden');
  $('camera-error').textContent = '';
  capturedDataUrl = null;

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
    video.srcObject = cameraStream;
    video.classList.remove('hidden');
    $('switch-camera-btn').classList.remove('hidden');
  } catch (err) {
    $('camera-error').textContent = 'Kamera izni reddedildi veya kamera bulunamadı. Tarayıcı ayarlarından izin verip tekrar dene.';
  }
}

function stopCamera() {
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
  const video = $('camera-video');
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (currentFacingMode === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  capturedDataUrl = canvas.toDataURL('image/jpeg', 0.82);

  video.classList.add('hidden');
  stopCamera();
  const img = $('captured-image');
  img.src = capturedDataUrl;
  img.classList.remove('hidden');
  $('snap-caption').classList.remove('hidden');
  $('shutter-controls').classList.add('hidden');
  $('preview-controls').classList.remove('hidden');
  $('switch-camera-btn').classList.add('hidden');
}

function retakeSnap() {
  capturedDataUrl = null;
  $('captured-image').classList.add('hidden');
  $('snap-caption').classList.add('hidden');
  $('preview-controls').classList.add('hidden');
  $('shutter-controls').classList.remove('hidden');
  requestCamera();
}

async function sendSnap() {
  if (!capturedDataUrl || !activeFriendId) return;
  const btn = $('send-snap-btn');
  btn.disabled = true;
  try {
    const caption = $('snap-caption').value.trim();
    const { message } = await postJSON('/api/messages', {
      receiverId: activeFriendId,
      type: 'snap',
      imageData: capturedDataUrl,
      caption,
      replyToId: replyingTo ? replyingTo.id : null,
    });
    localImageCache.set(message.id, capturedDataUrl);
    message.hasImage = true;
    const isNew = addMessageIfNew(activeFriendId, message);
    inboxByFriend.set(activeFriendId, message);
    if (isNew) {
      appendMessageDOM(message);
    } else {
      // socket echo already rendered this row before the HTTP response resolved;
      // refresh it now that the locally-cached snap image is available.
      const row = document.querySelector(`[data-msg-id="${message.id}"]`);
      if (row) updateSnapCardEl(row, message);
    }
    replyingTo = null;
    updateReplyBanner();
    renderSidebar();
    closeCamera();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
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
}

init();
