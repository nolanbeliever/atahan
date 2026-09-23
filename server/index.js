const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const store = require('./store');
const games = require('./games');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Auto-provisioned admin account. Override via env vars in production — these defaults
// are committed to a public repo, so anyone can read them.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'adminruhi';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hdabla';
store.ensureAdminAccount({ username: ADMIN_USERNAME, displayName: 'Admin', password: ADMIN_PASSWORD });

const PLUS_STREAK_MILESTONE_DAYS = 7;
const CHAT_BACKGROUNDS = ['gradient-sunset', 'gradient-ocean', 'gradient-mint', 'gradient-berry', 'stars', 'confetti'];

// iOS Safari only exposes the camera (getUserMedia) on a secure context: HTTPS, or the
// literal hostname "localhost". Plain http://<lan-ip>:3000 will not work from an iPhone.
// Drop a cert/key at certs/cert.pem + certs/key.pem (e.g. via mkcert) to serve HTTPS instead.
const certPath = process.env.HTTPS_CERT || path.join(__dirname, '..', 'certs', 'cert.pem');
const keyPath = process.env.HTTPS_KEY || path.join(__dirname, '..', 'certs', 'key.pem');
const useHttps = fs.existsSync(certPath) && fs.existsSync(keyPath);

const app = express();
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
  : http.createServer(app);
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

function requireAdmin(req, res, next) {
  const user = req.session.userId && store.findUserById(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Bu alana erişimin yok.' });
  next();
}

function requirePlus(req, res, next) {
  const user = store.findUserById(req.session.userId);
  if (!store.isPlusActive(user)) return res.status(403).json({ error: 'Bu özellik yalnızca Snoop Plus üyeleri içindir.' });
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
  res.json({ user: store.privateUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = store.findUserByUsername(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  req.session.userId = user.id;
  res.json({ user: store.privateUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = store.findUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: store.privateUser(user) });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = store.findUserById(req.session.userId);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Mevcut şifre yanlış.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı.' });
  }
  store.updatePasswordHash(user.id, bcrypt.hashSync(newPassword, 10));
  res.json({ ok: true });
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

// ---------- Profile (Plus perks) ----------

app.get('/api/profile/chat-backgrounds', requireAuth, (req, res) => {
  res.json({ backgrounds: CHAT_BACKGROUNDS });
});

app.post('/api/profile/chat-background', requireAuth, requirePlus, (req, res) => {
  const { background } = req.body || {};
  if (background !== null && !CHAT_BACKGROUNDS.includes(background)) {
    return res.status(400).json({ error: 'Geçersiz arka plan.' });
  }
  const user = store.setChatBackground(req.session.userId, background);
  res.json({ user: store.privateUser(user) });
});

app.post('/api/profile/best-friend', requireAuth, requirePlus, (req, res) => {
  const { friendId } = req.body || {};
  const fid = friendId ? Number(friendId) : null;
  if (fid && !store.areFriends(req.session.userId, fid)) {
    return res.status(400).json({ error: 'Yalnızca arkadaşlarını en sevdiğin arkadaş olarak seçebilirsin.' });
  }
  const user = store.setBestFriend(req.session.userId, fid);
  res.json({ user: store.privateUser(user) });
});

// ---------- Admin ----------

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: store.listAllUsersForAdmin() });
});

app.post('/api/admin/users/:id/grant-plus', requireAdmin, (req, res) => {
  const days = Number((req.body || {}).days) || 7;
  const user = store.grantPlus(Number(req.params.id), days);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  io.to(`user:${user.id}`).emit('plus:updated', { plusUntil: user.plus_until });
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/revoke-plus', requireAdmin, (req, res) => {
  const user = store.revokePlus(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  io.to(`user:${user.id}`).emit('plus:updated', { plusUntil: null });
  res.json({ ok: true });
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

  const streakResult = store.recordMessageForStreak(senderId, rid);
  if (streakResult) {
    io.to(`user:${senderId}`).emit('friend:streak', { friendId: rid, streak: streakResult.streak });
    io.to(`user:${rid}`).emit('friend:streak', { friendId: senderId, streak: streakResult.streak });
    if (streakResult.milestoneHit) {
      const userA = store.grantPlus(streakResult.userA, PLUS_STREAK_MILESTONE_DAYS);
      const userB = store.grantPlus(streakResult.userB, PLUS_STREAK_MILESTONE_DAYS);
      io.to(`user:${streakResult.userA}`).emit('plus:updated', {
        plusUntil: userA.plus_until,
        reason: 'streak',
        streak: streakResult.streak,
      });
      io.to(`user:${streakResult.userB}`).emit('plus:updated', {
        plusUntil: userB.plus_until,
        reason: 'streak',
        streak: streakResult.streak,
      });
    }
  }

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

function emitGameState(session, eventName) {
  for (const playerId of session.players) {
    io.to(`user:${playerId}`).emit(eventName, games.publicState(session, playerId));
  }
}

io.on('connection', (socket) => {
  const req = socket.request;
  const userId = req.session && req.session.userId;
  if (!userId) {
    socket.disconnect(true);
    return;
  }
  socket.join(`user:${userId}`);

  socket.on('game:invite', (payload, ack) => {
    try {
      const { toFriendId, gameType, difficulty } = payload || {};
      const fid = Number(toFriendId);
      if (!store.areFriends(userId, fid)) throw new Error('Önce arkadaş olmalısınız.');
      const invite = games.createInvite(userId, fid, gameType, difficulty);
      const fromUser = store.publicUser(store.findUserById(userId));
      io.to(`user:${fid}`).emit('game:invited', { inviteId: invite.id, from: fromUser, gameType, difficulty });
      if (ack) ack({ ok: true, inviteId: invite.id });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });

  socket.on('game:respond', (payload, ack) => {
    try {
      const { inviteId, accept } = payload || {};
      const invite = games.getInvite(inviteId);
      if (!invite || invite.toId !== userId) throw new Error('Davet bulunamadı ya da süresi doldu.');
      games.deleteInvite(inviteId);
      if (!accept) {
        io.to(`user:${invite.fromId}`).emit('game:declined', { inviteId });
        if (ack) ack({ ok: true });
        return;
      }
      const gameSession = games.createSession(invite.gameType, invite.difficulty, invite.fromId, invite.toId);
      emitGameState(gameSession, 'game:start');
      if (ack) ack({ ok: true, sessionId: gameSession.id });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });

  socket.on('game:invite-cancel', (payload) => {
    const { inviteId } = payload || {};
    const invite = games.getInvite(inviteId);
    if (invite && invite.fromId === userId) games.deleteInvite(inviteId);
  });

  socket.on('game:move', (payload, ack) => {
    try {
      const { sessionId, move } = payload || {};
      const result = games.applyMove(sessionId, userId, move);
      if (result.error) throw new Error(result.error);
      emitGameState(result.session, 'game:state');
      if (result.gameOver) {
        for (const playerId of result.session.players) {
          io.to(`user:${playerId}`).emit('game:over', { sessionId, winnerId: result.winnerId });
        }
        games.deleteSession(sessionId);
      }
      if (ack) ack({ ok: true });
    } catch (err) {
      if (ack) ack({ ok: false, error: err.message });
    }
  });

  socket.on('game:leave', (payload) => {
    const { sessionId } = payload || {};
    const gameSession = games.getSession(sessionId);
    if (!gameSession) return;
    const other = gameSession.players.find((p) => p !== userId);
    if (other) io.to(`user:${other}`).emit('game:opponent-left', { sessionId });
    games.deleteSession(sessionId);
  });

  socket.on('disconnect', () => {
    const activeSessions = games.sessionsForPlayer(userId);
    for (const gameSession of activeSessions) {
      const other = gameSession.players.find((p) => p !== userId);
      if (other) io.to(`user:${other}`).emit('game:opponent-left', { sessionId: gameSession.id });
      games.deleteSession(gameSession.id);
    }
  });
});

server.listen(PORT, () => {
  const scheme = useHttps ? 'https' : 'http';
  console.log(`Snoop web sunucusu ${scheme}://localhost:${PORT} adresinde çalışıyor`);
  if (!useHttps) {
    console.log(
      'Not: iPhone/Safari, yerel ağ IP\'si üzerinden (http://192.168.x.x) kamera erişimine izin vermez. ' +
      'Telefondan test için certs/cert.pem + certs/key.pem oluşturup HTTPS ile çalıştır (README\'ye bak).'
    );
  }
});
