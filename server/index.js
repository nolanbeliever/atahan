const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
});

app.use(express.json({ limit: '8mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Oturum açmalısın.' });
  next();
}

// ---------- Auth ----------

app.post('/api/auth/register', (req, res) => {
  const { username, displayName, password } = req.body || {};
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Kullanıcı adı, ad ve şifre gerekli.' });
  }
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ veya .).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }
  if (store.findUserByUsername(username)) {
    return res.status(409).json({ error: 'Bu kullanıcı adı zaten alınmış.' });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = store.createUser({ username, displayName, passwordHash });
  req.session.userId = user.id;
  res.json({ user: store.publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findUserByUsername(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  req.session.userId = user.id;
  res.json({ user: store.publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = store.findUserById(req.session.userId);
  res.json({ user: store.publicUser(user) });
});

// ---------- Users / Friends ----------

app.get('/api/users/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ users: [] });
  res.json({ users: store.searchUsers(q, req.session.userId) });
});

app.get('/api/friends', requireAuth, (req, res) => {
  res.json(store.listFriendsData(req.session.userId));
});

app.post('/api/friends/request', requireAuth, (req, res) => {
  const { username } = req.body || {};
  const target = store.findUserByUsername(username || '');
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  if (target.id === req.session.userId) return res.status(400).json({ error: 'Kendini ekleyemezsin.' });
  store.requestFriend(req.session.userId, target.id);
  io.to(`user:${target.id}`).emit('friend:request', { from: store.publicUser(store.findUserById(req.session.userId)) });
  res.json({ ok: true });
});

app.post('/api/friends/:id/respond', requireAuth, (req, res) => {
  const otherId = Number(req.params.id);
  const { accept } = req.body || {};
  const row = store.respondFriend(req.session.userId, otherId, !!accept);
  if (accept) {
    io.to(`user:${otherId}`).emit('friend:accepted', { by: store.publicUser(store.findUserById(req.session.userId)) });
  }
  res.json({ ok: true, row });
});

// ---------- Messages / Snaps ----------

app.get('/api/inbox', requireAuth, (req, res) => {
  const rows = store.getInbox(req.session.userId).map((m) => store.publicMessage(m));
  res.json({ messages: rows });
});

app.get('/api/messages/:friendId', requireAuth, (req, res) => {
  const friendId = Number(req.params.friendId);
  if (!store.areFriends(req.session.userId, friendId)) {
    return res.status(403).json({ error: 'Önce arkadaş olmalısınız.' });
  }
  const rows = store.getConversation(req.session.userId, friendId).map((m) => store.publicMessage(m));
  res.json({ messages: rows });
});

app.post('/api/messages', requireAuth, (req, res) => {
  const senderId = req.session.userId;
  const { receiverId, type, content, imageData, caption, replyToId } = req.body || {};
  const rid = Number(receiverId);
  if (!rid || !store.areFriends(senderId, rid)) {
    return res.status(403).json({ error: 'Önce arkadaş olmalısınız.' });
  }
  if (type === 'text') {
    if (!content || !content.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz.' });
  } else if (type === 'snap') {
    if (!imageData || !imageData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Geçersiz snap görüntüsü.' });
    }
  } else {
    return res.status(400).json({ error: 'Geçersiz mesaj tipi.' });
  }

  const msg = store.sendMessage({
    senderId,
    receiverId: rid,
    type,
    content: type === 'text' ? content.trim() : null,
    imageData: type === 'snap' ? imageData : null,
    caption: caption ? caption.trim() : null,
    replyToId: replyToId || null,
  });
  const payload = store.publicMessage(msg);
  io.to(`user:${rid}`).emit('message:new', payload);
  io.to(`user:${senderId}`).emit('message:new', payload);
  res.json({ message: payload });
});

app.post('/api/messages/:id/view', requireAuth, (req, res) => {
  const result = store.markSnapViewed(Number(req.params.id), req.session.userId);
  if (!result) return res.status(404).json({ error: 'Bulunamadı.' });
  if (result.alreadyViewed) {
    return res.status(410).json({ error: 'Bu snap zaten görüntülendi ve kayboldu.' });
  }
  const { message: msg } = result;
  const payload = store.publicMessage(msg, { includeImage: true });
  io.to(`user:${msg.sender_id}`).emit('message:viewed', { id: msg.id, viewedAt: msg.viewed_at });
  res.json({ message: payload });
});

// ---------- Socket.IO ----------

io.engine.use(sessionMiddleware);

io.on('connection', (socket) => {
  const req = socket.request;
  const userId = req.session && req.session.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }
  socket.join(`user:${userId}`);
});

server.listen(PORT, () => {
  console.log(`Snap web sunucusu http://localhost:${PORT} adresinde çalışıyor`);
});
