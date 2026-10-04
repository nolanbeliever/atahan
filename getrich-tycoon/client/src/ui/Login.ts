// Login / registration screen.

import { validatePassword, validatePlayerName } from '../../../shared/protocol';
import { ECONOMY } from '../../../shared/economy.config';
import { authRequest, session, type AuthResult } from '../net/api';
import { h } from './dom';

export function showLogin(root: HTMLElement, message = ''): Promise<AuthResult> {
  return new Promise((resolve) => {
    let mode: 'login' | 'register' = 'register';
    const name = h('input', { class: 'input', placeholder: 'Player name', autocomplete: 'username', maxlength: '16', 'data-testid': 'auth-name' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'new-password', 'data-testid': 'auth-password' });
    const err = h('div', { class: 'auth-error', 'data-testid': 'auth-error' }, message);
    const submit = h('button', { class: 'btn primary block', type: 'submit', 'data-testid': 'auth-submit' }, 'Create account & play');
    const tabLogin = h('button', { type: 'button' }, 'Log in');
    const tabRegister = h('button', { type: 'button', class: 'active' }, 'New player');
    const setMode = (m: typeof mode) => {
      mode = m;
      tabLogin.classList.toggle('active', m === 'login');
      tabRegister.classList.toggle('active', m === 'register');
      submit.textContent = m === 'login' ? 'Log in & play' : 'Create account & play';
      pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
      err.textContent = '';
    };
    tabLogin.addEventListener('click', () => setMode('login'));
    tabRegister.addEventListener('click', () => setMode('register'));
    const form = h(
      'form',
      { class: 'col', style: { gap: '12px' } },
      h('div', { class: 'tabs' }, tabRegister, tabLogin),
      name,
      pass,
      err,
      submit,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const problem = validatePlayerName(name.value) ?? validatePassword(pass.value);
      if (problem) {
        err.textContent = problem;
        return;
      }
      submit.disabled = true;
      err.textContent = '';
      try {
        const res = await authRequest(mode, name.value.trim(), pass.value);
        session.set(res.token);
        screen.remove();
        resolve(res);
      } catch (ex) {
        err.textContent = (ex as Error).message;
      } finally {
        submit.disabled = false;
      }
    });
    const screen = h(
      'div',
      { class: 'auth' },
      h(
        'div',
        { class: 'auth-card' },
        h('div', { class: 'auth-logo' }, 'GetRich', h('span', null, 'Tycoon')),
        h('div', { class: 'auth-tag' }, `Start with $${ECONOMY.player.startingMoney.toLocaleString('en-US')}. Buy low, fix up, sell high - and build the biggest dealership in town.`),
        form,
        h('div', { class: 'auth-foot' }, 'Multiplayer: everyone you see in the city is a real player. Your progress is saved on the server.'),
      ),
    );
    root.appendChild(screen);
    setTimeout(() => name.focus(), 50);
  });
}
