const db = require('./db');

const AVATAR_COLORS = ['#FFFC00', '#7C4DFF', '#00C2A8', '#FF6B6B', '#4D9DE0', '#FF8FAB', '#F4A259'];

function randomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function pairKey(a, b) {
  return a < b ? [a, b] : [b, a];
}

const users = {
  create: db.prepare(
    `INSERT INTO users (username, display_name, password_hash, avatar_color) VALUES (?, ?, ?, ?)`
  ),
  byUsername: db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`),
  byId: db.prepare(`SELECT * FROM users WHERE id = ?`),
  search: db.prepare(
    `SELECT id, username, display_name, avatar_color FROM users
     WHERE username LIKE ? AND id != ? ORDER BY username LIMIT 20`
  ),
};

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color };
}

function createUser({ username, displayName, passwordHash }) {
  const info = users.create.run(username, displayName, passwordHash, randomColor());
  return users.byId.get(info.lastInsertRowid);
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

function listFriendsData(userId) {
  const rows = friendships.forUser.all(userId, userId);
  const accepted = [];
  const incoming = [];
  const outgoing = [];
  for (const row of rows) {
    const otherId = row.user_a === userId ? row.user_b : row.user_a;
    const other = publicUser(users.byId.get(otherId));
    if (row.status === 'accepted') {
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

module.exports = {
  publicUser,
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
};
