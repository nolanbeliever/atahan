const tabBtns = document.querySelectorAll('.tab-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
    } else {
      registerForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
    }
  });
});

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir şeyler ters gitti.');
  return data;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    await postJSON('/api/auth/login', {
      username: document.getElementById('login-username').value.trim(),
      password: document.getElementById('login-password').value,
    });
    window.location.href = '/app.html';
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('register-error');
  errorEl.textContent = '';
  try {
    await postJSON('/api/auth/register', {
      displayName: document.getElementById('register-name').value.trim(),
      username: document.getElementById('register-username').value.trim(),
      password: document.getElementById('register-password').value,
    });
    window.location.href = '/app.html';
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// If already logged in, skip straight to the app.
fetch('/api/auth/me').then((r) => r.json()).then((data) => {
  if (data.user) window.location.href = '/app.html';
});
