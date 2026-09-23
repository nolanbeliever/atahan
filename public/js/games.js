/* Solo mini-games (fully client-side) and multiplayer game board renderers (state comes from
   the server via Socket.IO; these functions just render a given state and report a move back
   through onMove). Exposed as window.SnoopGames. */
(function () {
  const SOLO_GAMES = [
    { id: 'snake', emoji: '🐍', label: 'Yılan' },
    { id: '2048', emoji: '🔢', label: '2048' },
    { id: 'memory', emoji: '🧠', label: 'Hafıza' },
    { id: 'reaction', emoji: '⚡', label: 'Reaksiyon Hızı' },
    { id: 'whack', emoji: '🔨', label: 'Köstebek Vur' },
  ];

  const MULTIPLAYER_GAMES = [
    { id: 'tictactoe', emoji: '❌⭕', label: 'XO' },
    { id: 'rps', emoji: '✂️', label: 'Taş Kağıt Makas' },
    { id: 'mathduel', emoji: '🧮', label: 'Matematik Düellosu' },
  ];

  /* ---------- Solo: Snake ---------- */

  function runSnake(container, difficulty, cb) {
    const speedMap = { kolay: 180, orta: 120, zor: 70 };
    const tickMs = speedMap[difficulty] || 120;
    const gridSize = 14;
    const cellPx = 18;
    container.innerHTML = `
      <div class="game-score-row"><span>Skor: <b id="snake-score">0</b></span></div>
      <canvas id="snake-canvas" width="${gridSize * cellPx}" height="${gridSize * cellPx}" style="background:#0e0e10;border-radius:10px;"></canvas>
      <div class="game-controls-grid">
        <div></div><button data-dir="up">⬆️</button><div></div>
        <button data-dir="left">⬅️</button><button data-dir="down">⬇️</button><button data-dir="right">➡️</button>
      </div>
    `;
    const canvas = container.querySelector('#snake-canvas');
    const ctx = canvas.getContext('2d');
    let snake = [{ x: 7, y: 7 }];
    let dir = { x: 1, y: 0 };
    let nextDir = dir;
    let score = 0;
    let alive = true;

    function randomFood() {
      let pos;
      do {
        pos = { x: Math.floor(Math.random() * gridSize), y: Math.floor(Math.random() * gridSize) };
      } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
      return pos;
    }
    let food = randomFood();

    function draw() {
      ctx.fillStyle = '#0e0e10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#00E5B8';
      snake.forEach((s) => ctx.fillRect(s.x * cellPx + 1, s.y * cellPx + 1, cellPx - 2, cellPx - 2));
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(food.x * cellPx + 2, food.y * cellPx + 2, cellPx - 4, cellPx - 4);
    }

    function tick() {
      if (!alive) return;
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize || snake.some((s) => s.x === head.x && s.y === head.y)) {
        alive = false;
        clearInterval(intervalId);
        cb.onScore(score);
        return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        score += 1;
        container.querySelector('#snake-score').textContent = score;
        food = randomFood();
      } else {
        snake.pop();
      }
      draw();
    }

    draw();
    const intervalId = setInterval(tick, tickMs);
    container.querySelectorAll('[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
        const nd = map[btn.dataset.dir];
        if (nd.x === -dir.x && nd.y === -dir.y) return;
        nextDir = nd;
      });
    });
    return () => clearInterval(intervalId);
  }

  /* ---------- Solo: 2048 ---------- */

  function run2048(container, difficulty, cb) {
    const size = { kolay: 4, orta: 5, zor: 6 }[difficulty] || 4;
    let grid = Array.from({ length: size }, () => Array(size).fill(0));
    let score = 0;

    function addRandomTile() {
      const empty = [];
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) empty.push([r, c]);
      if (!empty.length) return;
      const [r, c] = empty[Math.floor(Math.random() * empty.length)];
      grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    }

    function tileColor(v) {
      const colors = { 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#00E5B8' };
      return colors[v] || '#3c3a32';
    }

    function mergeLine(line) {
      const arr = line.filter((v) => v);
      let gained = 0;
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i] === arr[i + 1]) { arr[i] *= 2; gained += arr[i]; arr.splice(i + 1, 1); }
      }
      while (arr.length < size) arr.push(0);
      return { line: arr, gained };
    }

    function isGameOver() {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!grid[r][c]) return false;
          if (c < size - 1 && grid[r][c] === grid[r][c + 1]) return false;
          if (r < size - 1 && grid[r][c] === grid[r + 1][c]) return false;
        }
      }
      return true;
    }

    function move(dir) {
      let moved = false;
      for (let i = 0; i < size; i++) {
        const line = [];
        for (let j = 0; j < size; j++) {
          if (dir === 'left') line.push(grid[i][j]);
          else if (dir === 'right') line.push(grid[i][size - 1 - j]);
          else if (dir === 'up') line.push(grid[j][i]);
          else line.push(grid[size - 1 - j][i]);
        }
        const merged = mergeLine(line);
        if (JSON.stringify(merged.line) !== JSON.stringify(line)) moved = true;
        score += merged.gained;
        for (let j = 0; j < size; j++) {
          const v = merged.line[j];
          if (dir === 'left') grid[i][j] = v;
          else if (dir === 'right') grid[i][size - 1 - j] = v;
          else if (dir === 'up') grid[j][i] = v;
          else grid[size - 1 - j][i] = v;
        }
      }
      if (moved) {
        addRandomTile();
        render();
        if (isGameOver()) cb.onScore(score);
      }
    }

    function render() {
      const cellSize = Math.floor(Math.min(300, window.innerWidth - 60) / size);
      let html = `<div class="game-score-row"><span>Skor: <b>${score}</b></span></div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(${size},${cellSize}px);gap:4px;">`;
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const v = grid[r][c];
          const bg = v ? tileColor(v) : '#1f1f23';
          html += `<div style="width:${cellSize}px;height:${cellSize}px;background:${bg};border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${cellSize > 50 ? 18 : 13}px;color:${v > 4 ? '#14140f' : '#f5f5f5'};">${v || ''}</div>`;
        }
      }
      html += '</div>';
      html += `<div class="game-controls-grid"><div></div><button data-dir="up">⬆️</button><div></div><button data-dir="left">⬅️</button><button data-dir="down">⬇️</button><button data-dir="right">➡️</button></div>`;
      container.innerHTML = html;
      container.querySelectorAll('[data-dir]').forEach((btn) => btn.addEventListener('click', () => move(btn.dataset.dir)));
    }

    addRandomTile();
    addRandomTile();
    render();
    return () => {};
  }

  /* ---------- Solo: Memory Match ---------- */

  function runMemory(container, difficulty, cb) {
    const pairs = { kolay: 6, orta: 8, zor: 12 }[difficulty] || 6;
    const emojiPool = ['🍎', '🍌', '🍇', '🍉', '🍓', '🍒', '🥝', '🍍', '🥥', '🍑', '🥑', '🍋'];
    const chosen = emojiPool.slice(0, pairs);
    const cards = [...chosen, ...chosen]
      .sort(() => Math.random() - 0.5)
      .map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));
    let flippedIds = [];
    let moves = 0;
    let locked = false;
    const cols = pairs <= 8 ? 4 : 6;

    function render() {
      let html = `<div class="game-score-row"><span>Hamle: <b>${moves}</b></span><span>Kalan: <b>${cards.filter((c) => !c.matched).length / 2}</b></span></div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;width:100%;max-width:320px;">`;
      for (const c of cards) {
        html += `<div class="memory-card ${c.flipped || c.matched ? 'flipped' : ''} ${c.matched ? 'matched' : ''}" data-id="${c.id}">${c.flipped || c.matched ? c.emoji : ''}</div>`;
      }
      html += '</div>';
      container.innerHTML = html;
      container.querySelectorAll('.memory-card').forEach((el) => el.addEventListener('click', () => flip(Number(el.dataset.id))));
    }

    function flip(id) {
      if (locked) return;
      const card = cards.find((c) => c.id === id);
      if (!card || card.flipped || card.matched) return;
      card.flipped = true;
      flippedIds.push(id);
      render();
      if (flippedIds.length === 2) {
        moves++;
        locked = true;
        const [a, b] = flippedIds.map((fid) => cards.find((c) => c.id === fid));
        if (a.emoji === b.emoji) {
          a.matched = true; b.matched = true;
          flippedIds = [];
          locked = false;
          render();
          if (cards.every((c) => c.matched)) cb.onScore(moves);
        } else {
          setTimeout(() => {
            a.flipped = false; b.flipped = false;
            flippedIds = [];
            locked = false;
            render();
          }, 700);
        }
      }
    }

    render();
    return () => {};
  }

  /* ---------- Solo: Reaction Time ---------- */

  function runReaction(container, difficulty, cb) {
    const totalRounds = { kolay: 1, orta: 3, zor: 5 }[difficulty] || 1;
    let round = 0;
    const times = [];
    let waitTimeout = null;
    let startTime = 0;
    let state = 'idle';

    function render(message, bg) {
      container.innerHTML = `
        <div class="game-score-row"><span>Tur: <b>${round}/${totalRounds}</b></span></div>
        <div id="reaction-box" style="width:100%;height:220px;border-radius:16px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:white;text-align:center;padding:20px;">${message}</div>
      `;
      container.querySelector('#reaction-box').addEventListener('click', onTap);
    }

    function startRound() {
      state = 'waiting';
      render('Hazırlan… yeşil olunca dokun!', '#c81e1e');
      const delay = 1000 + Math.random() * 2500;
      waitTimeout = setTimeout(() => {
        state = 'ready';
        startTime = performance.now();
        render('ŞİMDİ DOKUN!', '#00C2A8');
      }, delay);
    }

    function onTap() {
      if (state === 'waiting') {
        clearTimeout(waitTimeout);
        if (difficulty === 'zor') {
          render('Çok erken! Tekrar…', '#ff9500');
          setTimeout(startRound, 900);
        } else {
          startRound();
        }
        return;
      }
      if (state === 'ready') {
        const ms = Math.round(performance.now() - startTime);
        times.push(ms);
        round++;
        if (round >= totalRounds) {
          const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          render(`Bitti! Ortalama: ${avg} ms`, '#7C4DFF');
          state = 'idle';
          cb.onScore(avg);
        } else {
          render(`${ms} ms! Sıradaki tur…`, '#17171a');
          setTimeout(startRound, 900);
        }
      }
    }

    startRound();
    return () => clearTimeout(waitTimeout);
  }

  /* ---------- Solo: Whack-a-Mole ---------- */

  function runWhackAMole(container, difficulty, cb) {
    const upTime = { kolay: 900, orta: 600, zor: 380 }[difficulty] || 900;
    const duration = 30000;
    const holes = 9;
    let score = 0;
    let activeHole = -1;
    const endTime = Date.now() + duration;
    let moleTimeout;

    function render() {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      let html = `<div class="game-score-row"><span>Skor: <b>${score}</b></span><span>Süre: <b>${remaining}s</b></span></div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:280px;">`;
      for (let i = 0; i < holes; i++) {
        html += `<div class="game-grid-cell" data-hole="${i}" style="aspect-ratio:1;font-size:28px;">${i === activeHole ? '🐹' : '🕳️'}</div>`;
      }
      html += '</div>';
      container.innerHTML = html;
      container.querySelectorAll('[data-hole]').forEach((el) => el.addEventListener('click', () => whack(Number(el.dataset.hole))));
    }

    function popMole() {
      if (Date.now() >= endTime) return;
      activeHole = Math.floor(Math.random() * holes);
      render();
      moleTimeout = setTimeout(() => {
        activeHole = -1;
        render();
        popMole();
      }, upTime);
    }

    function whack(i) {
      if (i === activeHole) {
        score++;
        activeHole = -1;
        clearTimeout(moleTimeout);
        render();
        popMole();
      }
    }

    const tickInt = setInterval(() => {
      if (Date.now() >= endTime) {
        clearInterval(tickInt);
        clearTimeout(moleTimeout);
        activeHole = -1;
        render();
        cb.onScore(score);
        return;
      }
      render();
    }, 1000);

    popMole();
    return () => { clearInterval(tickInt); clearTimeout(moleTimeout); };
  }

  const SOLO_RUNNERS = { snake: runSnake, '2048': run2048, memory: runMemory, reaction: runReaction, whack: runWhackAMole };

  /* ---------- Multiplayer renderers ---------- */

  function renderTicTacToe(container, state, myId, onMove) {
    const isMyTurn = state.turn === myId;
    let status;
    if (state.winner) status = state.winner === myId ? 'Kazandın! 🎉' : 'Kaybettin 😢';
    else if (state.draw) status = 'Berabere!';
    else status = isMyTurn ? 'Sıra sende' : 'Rakip düşünüyor…';

    let html = `<div class="game-result-banner">${status}</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(${state.size},1fr);gap:6px;width:100%;max-width:${state.size * 70}px;">`;
    state.board.forEach((cell, i) => {
      const clickable = !state.winner && !state.draw && isMyTurn && !cell;
      html += `<div class="game-grid-cell" data-idx="${i}" style="aspect-ratio:1;font-size:${state.size > 4 ? 20 : 28}px;${clickable ? '' : `pointer-events:none;opacity:${cell ? 1 : 0.6};`}">${cell || ''}</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
    if (!state.winner && !state.draw && isMyTurn) {
      container.querySelectorAll('[data-idx]').forEach((el) => el.addEventListener('click', () => onMove({ index: Number(el.dataset.idx) })));
    }
  }

  function renderRPS(container, state, myId, onMove) {
    const oppId = Object.keys(state.scores).map(Number).find((id) => id !== myId);
    const myScore = state.scores[myId];
    const oppScore = state.scores[oppId];
    const myChoice = state.choices[myId];
    const emojiMap = { rock: '🪨', paper: '📄', scissors: '✂️' };

    let resultHtml = '';
    if (state.lastRound) {
      const mine = state.lastRound.choices[myId];
      const theirs = state.lastRound.choices[oppId];
      let text;
      if (!state.lastRound.winner) text = 'Berabere!';
      else text = state.lastRound.winner === myId ? 'Bu turu kazandın!' : 'Bu turu kaybettin!';
      resultHtml = `<div class="game-result-banner" style="font-size:15px;">${emojiMap[mine] || ''} vs ${emojiMap[theirs] || ''} — ${text}</div>`;
    }

    let statusHtml;
    if (state.winner) statusHtml = state.winner === myId ? '🏆 Maçı kazandın!' : 'Maçı kaybettin 😢';
    else if (myChoice) statusHtml = 'Rakip bekleniyor…';
    else statusHtml = 'Seçimini yap!';

    container.innerHTML = `
      <div class="game-score-row"><span>Sen: <b>${myScore}</b></span><span style="font-size:12px;">${state.bestOf} tur (ilk ${Math.ceil(state.bestOf / 2)})</span><span>Rakip: <b>${oppScore}</b></span></div>
      ${resultHtml}
      <div class="game-result-banner" style="font-size:14px;">${statusHtml}</div>
      <div class="rps-choices">
        <button class="rps-choice-btn ${myChoice === 'rock' ? 'picked' : ''}" data-c="rock" ${myChoice || state.winner ? 'disabled' : ''}>🪨</button>
        <button class="rps-choice-btn ${myChoice === 'paper' ? 'picked' : ''}" data-c="paper" ${myChoice || state.winner ? 'disabled' : ''}>📄</button>
        <button class="rps-choice-btn ${myChoice === 'scissors' ? 'picked' : ''}" data-c="scissors" ${myChoice || state.winner ? 'disabled' : ''}>✂️</button>
      </div>
    `;
    if (!myChoice && !state.winner) {
      container.querySelectorAll('.rps-choice-btn').forEach((el) => el.addEventListener('click', () => onMove({ choice: el.dataset.c })));
    }
  }

  function renderMathDuel(container, state, myId, onMove) {
    const oppId = Object.keys(state.scores).map(Number).find((id) => id !== myId);
    const myScore = state.scores[myId];
    const oppScore = state.scores[oppId];

    const statusHtml = state.winner
      ? (state.winner === myId ? '🏆 Kazandın!' : 'Kaybettin 😢')
      : `Tur ${state.round}/${state.targetRounds}`;

    const correct = state.problem.answer;
    const options = new Set([correct]);
    while (options.size < 4) {
      const delta = Math.floor(Math.random() * 10) - 5;
      if (delta !== 0) options.add(correct + delta);
    }
    const shuffled = Array.from(options).sort(() => Math.random() - 0.5);

    container.innerHTML = `
      <div class="game-score-row"><span>Sen: <b>${myScore}</b></span><span style="font-size:12px;">${statusHtml}</span><span>Rakip: <b>${oppScore}</b></span></div>
      <div class="math-problem">${state.problem.a} ${state.problem.op} ${state.problem.b} = ?</div>
      <div class="math-answer-grid">
        ${shuffled.map((v) => `<button class="math-answer-btn" data-v="${v}" ${state.winner ? 'disabled' : ''}>${v}</button>`).join('')}
      </div>
    `;
    if (!state.winner) {
      container.querySelectorAll('.math-answer-btn').forEach((el) => el.addEventListener('click', () => onMove({ answer: Number(el.dataset.v) })));
    }
  }

  const MULTIPLAYER_RENDERERS = { tictactoe: renderTicTacToe, rps: renderRPS, mathduel: renderMathDuel };

  window.SnoopGames = {
    soloGames: SOLO_GAMES,
    multiplayerGames: MULTIPLAYER_GAMES,
    runSolo(id, container, difficulty, cb) {
      const runner = SOLO_RUNNERS[id];
      if (!runner) return () => {};
      return runner(container, difficulty, cb);
    },
    renderMultiplayer(gameType, container, state, myId, onMove) {
      const renderer = MULTIPLAYER_RENDERERS[gameType];
      if (renderer) renderer(container, state, myId, onMove);
    },
  };
})();
