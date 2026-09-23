// In-memory real-time multiplayer game engine. Sessions are ephemeral (not persisted to
// SQLite) — a server restart simply ends any games in progress, which is fine for this.
const crypto = require('crypto');

const GAME_TYPES = ['tictactoe', 'rps', 'mathduel'];
const DIFFICULTIES = ['kolay', 'orta', 'zor'];

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* ---------- Tic-Tac-Toe (XO) — difficulty changes board size / win length ---------- */

function checkLineWinner(board, size, winLength) {
  const get = (r, c) => (r >= 0 && r < size && c >= 0 && c < size ? board[r * size + c] : null);
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const sym = get(r, c);
      if (!sym) continue;
      for (const [dr, dc] of dirs) {
        let count = 1;
        for (let k = 1; k < winLength; k++) {
          if (get(r + dr * k, c + dc * k) === sym) count++;
          else break;
        }
        if (count >= winLength) return sym;
      }
    }
  }
  return null;
}

const TICTACTOE_CONFIG = {
  kolay: { size: 3, winLength: 3 },
  orta: { size: 4, winLength: 4 },
  zor: { size: 5, winLength: 4 },
};

const tictactoe = {
  createInitialState(difficulty, playerA, playerB) {
    const cfg = TICTACTOE_CONFIG[difficulty] || TICTACTOE_CONFIG.kolay;
    return {
      size: cfg.size,
      winLength: cfg.winLength,
      board: Array(cfg.size * cfg.size).fill(null),
      turn: playerA,
      symbols: { [playerA]: 'X', [playerB]: 'O' },
      winner: null,
      draw: false,
    };
  },
  applyMove(state, playerId, players, move) {
    if (state.winner || state.draw) return { error: 'Oyun bitti.' };
    if (state.turn !== playerId) return { error: 'Sıra sende değil.' };
    const idx = Number(move.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.board.length || state.board[idx]) {
      return { error: 'Geçersiz hamle.' };
    }
    const board = state.board.slice();
    board[idx] = state.symbols[playerId];
    const winnerSymbol = checkLineWinner(board, state.size, state.winLength);
    let winnerId = null;
    let gameOver = false;
    let draw = false;
    if (winnerSymbol) {
      winnerId = players.find((p) => state.symbols[p] === winnerSymbol);
      gameOver = true;
    } else if (board.every((c) => c)) {
      draw = true;
      gameOver = true;
    }
    const newState = {
      ...state,
      board,
      turn: gameOver ? state.turn : players.find((p) => p !== playerId),
      winner: winnerId,
      draw,
    };
    return { state: newState, gameOver, winnerId };
  },
};

/* ---------- Rock-Paper-Scissors — difficulty changes match length (best of N) ---------- */

const RPS_BEST_OF = { kolay: 3, orta: 5, zor: 7 };
const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

function resolveRPS(a, b) {
  if (a === b) return 0;
  return RPS_BEATS[a] === b ? 1 : 2;
}

const rps = {
  createInitialState(difficulty, playerA, playerB) {
    return {
      bestOf: RPS_BEST_OF[difficulty] || 3,
      round: 1,
      scores: { [playerA]: 0, [playerB]: 0 },
      choices: {},
      lastRound: null,
      winner: null,
    };
  },
  applyMove(state, playerId, players, move) {
    if (state.winner) return { error: 'Oyun bitti.' };
    if (!RPS_CHOICES.includes(move.choice)) return { error: 'Geçersiz seçim.' };
    if (state.choices[playerId]) return { error: 'Bu tur için zaten seçim yaptın.' };
    const choices = { ...state.choices, [playerId]: move.choice };
    const otherId = players.find((p) => p !== playerId);
    if (!choices[otherId]) {
      return { state: { ...state, choices }, gameOver: false, winnerId: null };
    }
    const result = resolveRPS(choices[players[0]], choices[players[1]]);
    const scores = { ...state.scores };
    let roundWinner = null;
    if (result === 1) { scores[players[0]] += 1; roundWinner = players[0]; }
    else if (result === 2) { scores[players[1]] += 1; roundWinner = players[1]; }
    const neededWins = Math.ceil(state.bestOf / 2);
    const gameWinner = Object.keys(scores).find((p) => scores[p] >= neededWins) || null;
    const newState = {
      ...state,
      scores,
      choices: {},
      lastRound: { choices, winner: roundWinner },
      round: state.round + 1,
      winner: gameWinner,
    };
    return { state: newState, gameOver: !!gameWinner, winnerId: gameWinner };
  },
  sanitize(state, forPlayerId, players) {
    const otherId = players.find((p) => p !== forPlayerId);
    const sanitizedChoices = {};
    if (state.choices[forPlayerId]) sanitizedChoices[forPlayerId] = state.choices[forPlayerId];
    if (state.choices[otherId]) sanitizedChoices[otherId] = 'hidden';
    return { ...state, choices: sanitizedChoices };
  },
};

/* ---------- Quick Math Duel — difficulty changes problem complexity ---------- */

function generateMathProblem(difficulty) {
  let a; let b; let op;
  if (difficulty === 'zor') {
    const ops = ['+', '-', '*'];
    op = ops[randInt(0, 2)];
    if (op === '*') { a = randInt(2, 12); b = randInt(2, 12); }
    else { a = randInt(20, 100); b = randInt(20, 100); if (op === '-' && b > a) [a, b] = [b, a]; }
  } else if (difficulty === 'orta') {
    a = randInt(10, 50);
    b = randInt(10, 50);
    op = Math.random() < 0.5 ? '+' : '-';
    if (op === '-' && b > a) [a, b] = [b, a];
  } else {
    a = randInt(1, 10);
    b = randInt(1, 10);
    op = Math.random() < 0.5 ? '+' : '-';
    if (op === '-' && b > a) [a, b] = [b, a];
  }
  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  return { a, b, op, answer };
}

const TARGET_ROUNDS = 5;

const mathduel = {
  createInitialState(difficulty, playerA, playerB) {
    return {
      difficulty,
      targetRounds: TARGET_ROUNDS,
      round: 1,
      scores: { [playerA]: 0, [playerB]: 0 },
      problem: generateMathProblem(difficulty),
      winner: null,
    };
  },
  applyMove(state, playerId, players, move) {
    if (state.winner) return { error: 'Oyun bitti.' };
    const answer = Number(move.answer);
    if (Number.isNaN(answer)) return { error: 'Geçersiz cevap.' };
    if (answer !== state.problem.answer) return { error: 'Yanlış cevap!' };
    const scores = { ...state.scores, [playerId]: state.scores[playerId] + 1 };
    const gameOver = scores[playerId] >= state.targetRounds;
    const newState = {
      ...state,
      scores,
      round: state.round + 1,
      problem: gameOver ? state.problem : generateMathProblem(state.difficulty),
      winner: gameOver ? playerId : null,
      lastCorrectBy: playerId,
    };
    return { state: newState, gameOver, winnerId: gameOver ? playerId : null };
  },
};

const GAMES = { tictactoe, rps, mathduel };

/* ---------- Session / invite management ---------- */

const invites = new Map();
const sessions = new Map();

function createInvite(fromId, toId, gameType, difficulty) {
  if (!GAME_TYPES.includes(gameType)) throw new Error('Geçersiz oyun.');
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Geçersiz zorluk.');
  const id = genId();
  const invite = { id, fromId, toId, gameType, difficulty, createdAt: Date.now() };
  invites.set(id, invite);
  return invite;
}

function getInvite(id) {
  return invites.get(id);
}

function deleteInvite(id) {
  invites.delete(id);
}

function createSession(gameType, difficulty, playerA, playerB) {
  const id = genId();
  const state = GAMES[gameType].createInitialState(difficulty, playerA, playerB);
  const session = { id, gameType, difficulty, players: [playerA, playerB], state, createdAt: Date.now() };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

function deleteSession(id) {
  sessions.delete(id);
}

function applyMove(sessionId, playerId, move) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'Oturum bulunamadı.' };
  if (!session.players.includes(playerId)) return { error: 'Bu oyunda değilsin.' };
  const game = GAMES[session.gameType];
  const result = game.applyMove(session.state, playerId, session.players, move || {});
  if (result.error) return { error: result.error };
  session.state = result.state;
  return { session, gameOver: result.gameOver, winnerId: result.winnerId };
}

function publicState(session, forPlayerId) {
  const game = GAMES[session.gameType];
  const state = game.sanitize ? game.sanitize(session.state, forPlayerId, session.players) : session.state;
  return {
    sessionId: session.id,
    gameType: session.gameType,
    difficulty: session.difficulty,
    players: session.players,
    state,
  };
}

function sessionsForPlayer(playerId) {
  return Array.from(sessions.values()).filter((s) => s.players.includes(playerId));
}

module.exports = {
  GAME_TYPES,
  DIFFICULTIES,
  createInvite,
  getInvite,
  deleteInvite,
  createSession,
  getSession,
  deleteSession,
  applyMove,
  publicState,
  sessionsForPlayer,
};
