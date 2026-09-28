// Client entry point.

import './styles/main.css';
import { Game } from './game/Game';
import { session } from './net/api';
import { showLogin } from './ui/Login';
import { UI } from './ui/UI';

declare global {
  interface Window {
    __getrich?: { game: Game; state: () => ReturnType<Game['debugState']> };
  }
}

function hideBoot(): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('hidden');
  setTimeout(() => boot.remove(), 500);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const gameRoot = document.getElementById('game-root')!;
  const uiRoot = document.getElementById('ui-root')!;
  if (!webglAvailable()) {
    hideBoot();
    uiRoot.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'auth';
    msg.textContent = 'GetRich Tycoon needs WebGL. Please use a recent version of Chrome, Edge or Firefox with hardware acceleration enabled.';
    uiRoot.appendChild(msg);
    return;
  }
  let token = session.get();
  hideBoot();
  if (!token) token = (await showLogin(uiRoot)).token;

  const game = new Game(gameRoot, token);
  const ui = new UI(uiRoot, game);
  game.attachUI(ui);
  window.__getrich = { game, state: () => game.debugState() };

  game.net.socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      session.clear();
      game.stop();
      uiRoot.innerHTML = '';
      void showLogin(uiRoot, 'Your session expired. Please log in again.').then(() => location.reload());
    }
  });
  game.start();
}

void main();
