const bcrypt = require('bcryptjs');
const db = require('./db');

const AVATAR_COLORS = ['#00E5B8', '#7C4DFF', '#00C2A8', '#FF6B6B', '#4D9DE0', '#FF8FAB', '#F4A259'];

function randomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00Z').getTime();
  const b = new Date(dateStrB + 'T00:00:00Z').getTime();
  return Math.round((a - b) / 86400000);
}

const users = {
  create: db.prepare(
    `INSERT INTO users (username, display_name, password_hash, avatar_color) VALUES (?, ?, ?, ?)`
  ),
  byUsername: db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  search: db.prepare(
    `SELECT id, username, display_name, avatar_color, plus_until FROM users
     WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 20`
  ),
  listAll: db.prepare(`SELECT * FROM users ORDER BY created_at DESC`),
  setAdmin: db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`),
  setPlusUntil: db.prepare(`UPDATE users SET plus_until = ? WHERE id = ?`),
  setPasswordHash: db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`),
  setChatBackground: db.prepare(`UPDATE users SET chat_background = ? WHERE id = ?`),
  setBestFriend: db.prepare(`UPDATE users SET best_friend_id = ? WHERE id = ?`),
};

function isPlusActive(u) {
  return !!(u.plus_until && new Date(u.plus_until).getTime() > Date.now());
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    plusActive: isPlusActive(u),
  };
}

function privateUser(u) {
  if (!u) return null;
  return {
    ...publicUser(u),
    isAdmin: !!u.is_admin,
    plusUntil: u.plus_until,
    chatBackground: u.chat_background,
    bestFriendId: u.best_friend_id,
  };
}

function createUser({ username, displayName, passwordHash }) {
  const info = users.create.run(username, displayName, passwordHash, randomColor());
  return users.byId.get(info.lastInsertRowid);
}

function ensureAdminAccount({ username, displayName, password }) {
  let admin = users.byUsername.get(username);
  if (!admin) {
    const passwordHash = bcrypt.hashSync(password, 10);
    const info = users.create.run(username, displayName, passwordHash, '#7C4DFF');
    admin = users.byId.get(info.lastInsertRowid);
  }
  if (!admin.is_admin) {
    users.setAdmin.run(1, admin.id);
  }
}

function listAllUsersForAdmin() {
  return users.listAll.all().map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isAdmin: !!u.is_admin,
    plusActive: isPlusActive(u),
    plusUntil: u.plus_until,
    createdAt: u.created_at,
  }));
}

function grantPlus(userId, days) {
  const user = users.byId.get(userId);
  if (!user) return null;
  const now = Date.now();
  const currentUntil = user.plus_until ? new Date(user.plus_until).getTime() : 0;
  const base = Math.max(now, currentUntil);
  const newUntil = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
  users.setPlusUntil.run(newUntil, userId);
  return users.byId.get(userId);
}

function revokePlus(userId) {
  users.setPlusUntil.run(null, userId);
  return users.byId.get(userId);
}

function updatePasswordHash(userId, passwordHash) {
  users.setPasswordHash.run(passwordHash, userId);
}

function setChatBackground(userId, background) {
  users.setChatBackground.run(background, userId);
  return users.byId.get(userId);
}

function setBestFriend(userId, friendId) {
  users.setBestFriend.run(friendId, userId);
  return users.byId.get(userId);
}

const friendships = {
  get: db.prepare(`SELECT * FROM friendships WHERE user_a = ? AND user_b = ?`),
  create: db.prepare(
    `INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES (?, ?, 'pending', ?)`
  ),
  accept: db.prepare(`UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?`),
  delete: db.prepare(`DELETE FROM friendships WHERE user_a = ? AND user_b = ?`),
  forUser: db.prepare(`
    SELECT f.*, ua.username AS a_username, ub.username AS b_username
    FROM friendships f
    JOIN users ua ON ua.id = f.user_a
    JOIN users ub ON ub.id = f.user_b
    WHERE f.user_a = ? OR f.user_b = ?
  `),
  updateSendDateA: db.prepare(`UPDATE friendships SET last_a_send_date = ? WHERE user_a = ? AND user_b = ?`),
  updateSendDateB: db.prepare(`UPDATE friendships SET last_b_send_date = ? WHERE user_a = ? AND user_b = ?`),
  bumpStreak: db.prepare(`UPDATE friendships SET streak_count = ?, last_bump_date = ? WHERE user_a = ? AND user_b = ?`),
};

function requestFriend(fromId, toId) {
  const [a, b] = pairKey(fromId, toId);
  const existing = friendships.get.get(a, b);
  if (existing) return existing;
  friendships.create.run(a, b, fromId);
  return friendships.get.get(a, b);
}

function respondFriend(userId, otherId, accept) {
  const [a, b] = pairKey(userId, otherId);
  if (accept) {
    friendships.accept.run(a, b);
  } else {
    friendships.delete.run(a, b);
  }
  return friendships.get.get(a, b);
}

function effectiveStreak(streakCount, lastBumpDate) {
  if (!lastBumpDate || !streakCount) return 0;
  const gap = daysBetween(todayUTC(), lastBumpDate);
  return gap <= 1 ? streakCount : 0;
}

function getStreakForPair(userId, otherId) {
  const [a, b] = pairKey(userId, otherId);
  const row = friendships.get.get(a, b);
  if (!row) return 0;
  return effectiveStreak(row.streak_count, row.last_bump_date);
}

// Called after a message/snap is sent. If both sides have now sent something on the
// same calendar day, the streak advances (once per day). Every 50th day awards a
// week of Plus to both participants.
function recordMessageForStreak(senderId, receiverId) {
  const [a, b] = pairKey(senderId, receiverId);
  let row = friendships.get.get(a, b);
  if (!row || row.status !== 'accepted') return null;
  const today = todayUTC();
  const senderIsA = senderId === a;
  if (senderIsA) friendships.updateSendDateA.run(today, a, b);
  else friendships.updateSendDateB.run(today, a, b);
  row = friendships.get.get(a, b);

  let newStreak = effectiveStreak(row.streak_count, row.last_bump_date);
  let milestoneHit = false;

  if (row.last_a_send_date === today && row.last_b_send_date === today && row.last_bump_date !== today) {
    const gap = row.last_bump_date ? daysBetween(today, row.last_bump_date) : null;
    newStreak = gap === 1 ? row.streak_count + 1 : 1;
    friendships.bumpStreak.run(newStreak, today, a, b);
    if (newStreak > 0 && newStreak % 50 === 0) milestoneHit = true;
  }

  return { streak: newStreak, milestoneHit, userA: a, userB: b };
}

function listFriendsData(userId) {
  const rows = friendships.forUser.all(userId, userId);
  const me = users.byId.get(userId);
  const accepted = [];
  const incoming = [];
  const outgoing = [];
  for (const row of rows) {
    const otherId = row.user_a === userId ? row.user_b : row.user_a;
    const other = publicUser(users.byId.get(otherId));
    if (row.status === 'accepted') {
      other.streak = effectiveStreak(row.streak_count, row.last_bump_date);
      other.isBestFriend = me.best_friend_id === otherId;
      accepted.push(other);
    } else if (row.requested_by === userId) {
      outgoing.push(other);
    } else {
      incoming.push(other);
    }
  }
  return { accepted, incoming, outgoing };
}

function areFriends(userId, otherId) {
  const [a, b] = pairKey(userId, otherId);
  const row = friendships.get.get(a, b);
  return !!row && row.status === 'accepted';
}

const messages = {
  insert: db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, type, content, image_data, caption, reply_to_id)
    VALUES (@senderId, @receiverId, @type, @content, @imageData, @caption, @replyToId)
  `),
  byId: db.prepare(`SELECT * FROM messages WHERE id = ?`),
  conversation: db.prepare(`
    SELECT * FROM messages
    WHERE (sender_id = @a AND receiver_id = @b) OR (sender_id = @b AND receiver_id = @a)
    ORDER BY created_at ASC, id ASC
  `),
  markViewed: db.prepare(`UPDATE messages SET viewed_at = datetime('now') WHERE id = ? AND viewed_at IS NULL`),
  clearImage: db.prepare(`UPDATE messages SET image_data = NULL WHERE id = ?`),
  lastPerFriend: db.prepare(`
    SELECT m.*
    FROM messages m
    INNER JOIN (
      SELECT MAX(id) AS max_id
      FROM messages
      WHERE sender_id = @me OR receiver_id = @me
      GROUP BY CASE WHEN sender_id = @me THEN receiver_id ELSE sender_id END
    ) latest ON latest.max_id = m.id
  `),
};

function publicMessage(m, { includeImage = false } = {}) {
  if (!m) return null;
  return {
    id: m.id,
    senderId: m.sender_id,
    receiverId: m.receiver_id,
    type: m.type,
    content: m.content,
    imageData: m.type === 'snap' && includeImage ? m.image_data : undefined,
    hasImage: m.type === 'snap' ? !!m.image_data : undefined,
    caption: m.caption,
    replyToId: m.reply_to_id,
    viewedAt: m.viewed_at,
    createdAt: m.created_at,
  };
}

function sendMessage({ senderId, receiverId, type, content, imageData, caption, replyToId }) {
  const info = messages.insert.run({
    senderId,
    receiverId,
    type,
    content: content || null,
    imageData: imageData || null,
    caption: caption || null,
    replyToId: replyToId || null,
  });
  return messages.byId.get(info.lastInsertRowid);
}

function getConversation(userId, friendId) {
  return messages.conversation.all({ a: userId, b: friendId });
}

function markSnapViewed(messageId, viewerId) {
  const m = messages.byId.get(messageId);
  if (!m || m.receiver_id !== viewerId || m.type !== 'snap') return null;
  if (m.viewed_at) return { alreadyViewed: true, message: m };
  const imageData = m.image_data;
  messages.markViewed.run(messageId);
  messages.clearImage.run(messageId);
  const updated = messages.byId.get(messageId);
  updated.image_data = imageData; // return the one-time image to the caller only
  return { alreadyViewed: false, message: updated };
}

function getInbox(userId) {
  return messages.lastPerFriend.all({ me: userId });
}

/* ---------- Gallery (private "Memories") ---------- */

const gallery = {
  insert: db.prepare(`INSERT INTO gallery_items (user_id, image_data, caption) VALUES (?, ?, ?)`),
  byId: db.prepare(`SELECT * FROM gallery_items WHERE id = ?`),
  forUser: db.prepare(`SELECT * FROM gallery_items WHERE user_id = ? ORDER BY created_at DESC, id DESC`),
  delete: db.prepare(`DELETE FROM gallery_items WHERE id = ? AND user_id = ?`),
};

function publicGalleryItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    imageData: item.image_data,
    caption: item.caption,
    createdAt: item.created_at,
  };
}

function addGalleryItem(userId, imageData, caption) {
  const info = gallery.insert.run(userId, imageData, caption || null);
  return publicGalleryItem(gallery.byId.get(info.lastInsertRowid));
}

function getGalleryItems(userId) {
  return gallery.forUser.all(userId).map(publicGalleryItem);
}

function deleteGalleryItem(id, userId) {
  const result = gallery.delete.run(id, userId);
  return result.changes > 0;
}

module.exports = {
  publicUser,
  privateUser,
  createUser,
  findUserByUsername: (u) => users.byUsername.get(u),
  findUserById: (id) => users.byId.get(id),
  searchUsers: (q, excludeId) => users.search.all(`%${q}%`, excludeId).map(publicUser),
  requestFriend,
  respondFriend,
  listFriendsData,
  areFriends,
  publicMessage,
  sendMessage,
  getConversation,
  markSnapViewed,
  getInbox,
  isPlusActive,
  ensureAdminAccount,
  listAllUsersForAdmin,
  grantPlus,
  revokePlus,
  updatePasswordHash,
  setChatBackground,
  setBestFriend,
  getStreakForPair,
  recordMessageForStreak,
  addGalleryItem,
  getGalleryItems,
  deleteGalleryItem,
};
