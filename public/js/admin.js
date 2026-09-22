function $(id) { return document.getElementById(id); }

function toast(text) {
  const stack = $('toast-stack');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
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
  if (!res.ok) throw new Error(data.error || 'Hata oluştu.');
  return data;
}

function plusLabel(u) {
  if (!u.plusActive) return 'Yok';
  const d = new Date(u.plusUntil);
  return 'Aktif — ' + d.toLocaleDateString('tr-TR') + ' tarihine kadar';
}

function renderRow(u) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <div class="n">${escapeHtml(u.displayName)}</div>
      <div class="u">@${escapeHtml(u.username)}</div>
    </td>
    <td>${u.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}</td>
    <td class="plus-status">${plusLabel(u)}</td>
    <td class="admin-actions">
      <input type="number" min="1" value="7" class="days-input" />
      <button class="pill-btn accept grant-btn">Plus Ver</button>
      <button class="pill-btn decline revoke-btn" ${u.plusActive ? '' : 'disabled'}>Kaldır</button>
    </td>
  `;
  tr.querySelector('.grant-btn').addEventListener('click', async () => {
    const days = Number(tr.querySelector('.days-input').value) || 7;
    try {
      await postJSON(`/api/admin/users/${u.id}/grant-plus`, { days });
      toast(`${u.displayName} kullanıcısına ${days} günlük Plus verildi.`);
      loadUsers();
    } catch (e) {
      toast(e.message);
    }
  });
  tr.querySelector('.revoke-btn').addEventListener('click', async () => {
    try {
      await postJSON(`/api/admin/users/${u.id}/revoke-plus`, {});
      toast(`${u.displayName} kullanıcısının Plus'ı kaldırıldı.`);
      loadUsers();
    } catch (e) {
      toast(e.message);
    }
  });
  return tr;
}

async function loadUsers() {
  const { users } = await getJSON('/api/admin/users');
  const tbody = $('admin-rows');
  tbody.innerHTML = '';
  for (const u of users) tbody.appendChild(renderRow(u));
  $('admin-table').classList.remove('hidden');
  $('admin-hint').textContent = `${users.length} kullanıcı`;
}

function bindChangePassword() {
  $('change-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('cp-error');
    errorEl.textContent = '';
    try {
      await postJSON('/api/auth/change-password', {
        currentPassword: $('cp-current').value,
        newPassword: $('cp-new').value,
      });
      $('cp-current').value = '';
      $('cp-new').value = '';
      toast('Şifren güncellendi.');
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

async function init() {
  const { user } = await getJSON('/api/auth/me');
  if (!user) {
    window.location.href = '/index.html';
    return;
  }
  bindChangePassword();
  if (!user.isAdmin) {
    $('admin-hint').textContent = 'Bu sayfaya erişimin yok.';
    $('admin-table').classList.add('hidden');
    return;
  }
  try {
    await loadUsers();
  } catch (e) {
    $('admin-hint').textContent = e.message;
  }
}

init();
