const $ = (selector) => document.querySelector(selector);

function todayLocal() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const state = {
  date: todayLocal(),
  dashboard: null,
  user: null,
  knownBookingIds: new Set(),
  hasDashboardSnapshot: false,
  soundEnabled: false,
  audioContext: null,
  pollTimer: null,
};

const login = $('#login');
const app = $('#app');
const loginForm = $('#loginForm');
const bookingForm = $('#bookingForm');
const staffForm = $('#staffForm');
const dateInput = $('#dateInput');
const columns = $('#columns');
const soundToggle = $('#soundToggle');
const liveStatus = $('#liveStatus');

const SEATS_BY_ZONE = {
  zal: [1, 2, 3, 4, 5],
  cabinet: [6, 7, 8],
  vip: [9, 10],
};

function money(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₸`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char];
  });
}

function dayLabel(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00`));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showLogin();
    throw new Error(data.error || 'Нужен вход.');
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Ошибка запроса.');
  return data;
}

function showLogin() {
  login.classList.remove('hidden');
  app.classList.add('hidden');
  stopAutoRefresh();
}

function showApp() {
  login.classList.add('hidden');
  app.classList.remove('hidden');
  renderCurrentUser();
  updateSoundButton();
  startAutoRefresh();
}

function renderCurrentUser() {
  const label = state.user?.name || state.user?.username || 'Сотрудник';
  $('#currentUser').textContent = label;
  $('#staffPanel').classList.toggle('hidden', state.user?.role !== 'admin');
}

function updateLiveStatus(text = 'Онлайн') {
  liveStatus.textContent = text;
}

function updateSoundButton() {
  soundToggle.textContent = state.soundEnabled ? 'Звук вкл' : 'Звук выкл';
  soundToggle.classList.toggle('is-on', state.soundEnabled);
}

async function enableSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Браузер не поддерживает звуковые уведомления.');
  }
  if (!state.audioContext) state.audioContext = new AudioCtx();
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();
  state.soundEnabled = true;
  updateSoundButton();
  playNotificationSound();
}

function disableSound() {
  state.soundEnabled = false;
  updateSoundButton();
}

function playNotificationSound() {
  if (!state.soundEnabled || !state.audioContext) return;
  const ctx = state.audioContext;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  gain.connect(ctx.destination);

  for (const [offset, frequency] of [[0, 880], [0.16, 1175]]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now + offset);
    osc.connect(gain);
    osc.start(now + offset);
    osc.stop(now + offset + 0.18);
  }
}

function notifyNewBookings(bookings) {
  if (!bookings.length) return;
  playNotificationSound();
  updateLiveStatus(`Новая бронь #${bookings[bookings.length - 1].id}`);
  setTimeout(() => updateLiveStatus('Онлайн'), 5000);
}

function resetBookingSnapshot() {
  state.knownBookingIds = new Set();
  state.hasDashboardSnapshot = false;
}

function formPayload() {
  const fd = new FormData(bookingForm);
  const payload = {
    id: fd.get('id'),
    date: state.date,
    clientName: fd.get('clientName'),
    phone: fd.get('phone'),
    zone: fd.get('zone'),
    seat: fd.get('seat'),
    time: fd.get('time'),
    durationMinutes: Number(fd.get('durationMinutes')),
    withCombo: fd.get('withCombo') === 'on',
    note: fd.get('note'),
  };
  if (payload.durationMinutes === 60) payload.withCombo = false;
  return payload;
}

function resetForm() {
  bookingForm.reset();
  bookingForm.elements.id.value = '';
  bookingForm.elements.time.value = '15:00';
  $('#formTitle').textContent = 'Новая бронь';
  $('#formError').textContent = '';
  syncSeatOptions();
  syncComboAvailability();
}

function editBooking(booking) {
  bookingForm.elements.id.value = booking.id;
  bookingForm.elements.clientName.value = booking.clientName || '';
  bookingForm.elements.phone.value = booking.phone || '';
  bookingForm.elements.zone.value = booking.zone;
  syncSeatOptions(booking.seat);
  bookingForm.elements.time.value = booking.time;
  bookingForm.elements.durationMinutes.value = booking.durationMinutes;
  bookingForm.elements.withCombo.checked = booking.withCombo;
  bookingForm.elements.note.value = booking.note || '';
  $('#formTitle').textContent = `Бронь #${booking.id}`;
  $('#formError').textContent = '';
  syncComboAvailability();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncSeatOptions(preferredSeat = null) {
  const zone = bookingForm.elements.zone.value;
  const seatSelect = bookingForm.elements.seat;
  const seats = SEATS_BY_ZONE[zone] || [];
  const current = preferredSeat ?? seatSelect.value;
  seatSelect.innerHTML = seats.map((seat) => `<option value="${seat}">Место ${seat}</option>`).join('');
  if (seats.map(String).includes(String(current))) seatSelect.value = String(current);
}

function syncComboAvailability() {
  const duration = Number(bookingForm.elements.durationMinutes.value);
  const combo = bookingForm.elements.withCombo;
  const unavailable = duration === 60;
  if (unavailable) combo.checked = false;
  combo.disabled = unavailable;
}

async function cancelBooking(id) {
  if (!confirm(`Отменить бронь #${id}?`)) return;
  await api(`/api/bookings/${id}`, { method: 'DELETE' });
  await loadDashboard();
}

function sourceClass(source) {
  if (source === 'Telegram') return 'telegram';
  if (source === 'WhatsApp') return 'whatsapp';
  return 'staff';
}

function bookingCard(booking) {
  const card = document.createElement('article');
  card.className = 'booking-card';
  card.dataset.source = booking.source;
  card.dataset.status = booking.status;
  const source = escapeHtml(booking.source);
  const clientName = escapeHtml(booking.clientName || 'Клиент');
  const phone = escapeHtml(booking.phone);
  const note = escapeHtml(booking.note);
  const zoneLabel = escapeHtml(booking.zoneLabel || booking.zone);
  const seat = booking.seat ? escapeHtml(`Место ${booking.seat}`) : 'Место не выбрано';
  card.innerHTML = `
    <strong>${escapeHtml(booking.time)} - ${escapeHtml(booking.endTime)}</strong>
    <div class="booking-primary">${clientName}</div>
    <div class="booking-phone">${phone || 'Телефон не указан'}</div>
    <div class="booking-badges">
      <span>${zoneLabel}</span>
      <span>${seat}</span>
    </div>
    <div class="booking-meta">${Number(booking.durationMinutes || 0) / 60} ч · ${money(booking.totalPrice)} · <span><i class="dot ${sourceClass(booking.source)}"></i> ${source}</span></div>
    ${note ? `<div class="booking-client">${note}</div>` : ''}
    <div class="booking-actions">
      <button class="ghost small" data-action="edit">Изменить</button>
      ${booking.status !== 'cancelled' ? '<button class="danger small" data-action="cancel">Отменить</button>' : ''}
    </div>
  `;
  card.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    if (action === 'cancel') {
      event.stopPropagation();
      cancelBooking(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    editBooking(booking);
  });
  return card;
}

function renderDashboard(data, { notify = false } = {}) {
  const activeIds = new Set(data.bookings.filter((b) => b.status !== 'cancelled').map((b) => Number(b.id)));
  const newBookings =
    notify && state.hasDashboardSnapshot
      ? data.bookings.filter((b) => b.status !== 'cancelled' && !state.knownBookingIds.has(Number(b.id)))
      : [];

  state.dashboard = data;
  state.knownBookingIds = activeIds;
  state.hasDashboardSnapshot = true;
  showApp();
  dateInput.value = data.date;
  $('#dayTitle').textContent = dayLabel(data.date);
  $('#statActive').textContent = data.stats.active;
  $('#statRevenue').textContent = money(data.stats.revenue);
  $('#statOnline').textContent = data.stats.telegram + data.stats.whatsapp;
  $('#statStaff').textContent = data.stats.staff;
  columns.innerHTML = '';

  for (const zone of ['zal', 'cabinet', 'vip']) {
    const column = document.createElement('section');
    column.className = 'zone-column';
    const rows = data.bookings.filter((b) => b.zone === zone);
    const activeCount = rows.filter((b) => b.status !== 'cancelled').length;
    column.innerHTML = `
      <div class="zone-title">
        ${escapeHtml(data.zones[zone].label)}
        <span>${activeCount}/${data.capacity[zone]} сейчас</span>
      </div>
    `;
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Броней нет';
      column.append(empty);
    }
    rows.forEach((booking) => column.append(bookingCard(booking)));
    columns.append(column);
  }

  notifyNewBookings(newBookings);
}

async function loadDashboard({ notify = false, refreshStaff = false } = {}) {
  if (!state.user) {
    const me = await api('/api/me');
    state.user = me.user;
  }
  const data = await api(`/api/dashboard?date=${state.date}`);
  renderDashboard(data, { notify });
  updateLiveStatus('Онлайн');
  if (refreshStaff && state.user?.role === 'admin') loadStaff().catch((e) => ($('#staffError').textContent = e.message));
}

async function pollDashboard() {
  if (!state.user || app.classList.contains('hidden')) return;
  try {
    await loadDashboard({ notify: true, refreshStaff: false });
  } catch (e) {
    updateLiveStatus('Нет связи');
  }
}

function startAutoRefresh() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollDashboard, 5000);
}

function stopAutoRefresh() {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function editStaff(staff) {
  staffForm.elements.username.value = staff.username;
  staffForm.elements.name.value = staff.name || staff.username;
  staffForm.elements.role.value = staff.role || 'staff';
  staffForm.elements.password.value = '';
  $('#staffError').textContent = '';
}

async function removeStaff(username) {
  if (!confirm(`Удалить сотрудника ${username}?`)) return;
  await api(`/api/staff/${encodeURIComponent(username)}`, { method: 'DELETE' });
  await loadStaff();
}

function renderStaff(staff) {
  const list = $('#staffList');
  list.innerHTML = '';
  for (const item of staff) {
    const row = document.createElement('div');
    row.className = 'staff-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.name || item.username)}</strong>
        <span>${escapeHtml(item.username)} · ${item.role === 'admin' ? 'Админ' : 'Сотрудник'}</span>
      </div>
      <div class="staff-actions">
        <button class="ghost small" data-action="edit">Изменить</button>
        <button class="danger small" data-action="delete">Удалить</button>
      </div>
    `;
    row.querySelector('[data-action="edit"]').addEventListener('click', () => editStaff(item));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => removeStaff(item.username).catch((e) => ($('#staffError').textContent = e.message)));
    list.append(row);
  }
}

async function loadStaff() {
  const data = await api('/api/staff');
  renderStaff(data.staff || []);
}

function shiftDay(delta) {
  const d = new Date(`${state.date}T12:00:00`);
  d.setDate(d.getDate() + delta);
  state.date = d.toISOString().slice(0, 10);
  resetBookingSnapshot();
  resetForm();
  loadDashboard({ refreshStaff: true }).catch((e) => ($('#formError').textContent = e.message));
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const fd = new FormData(loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ user: fd.get('user'), password: fd.get('password') }),
    }).then((data) => {
      state.user = data.user;
    });
    await loadDashboard({ refreshStaff: true });
  } catch (e) {
    $('#loginError').textContent = e.message;
  }
});

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#formError').textContent = '';
  const payload = formPayload();
  try {
    if (payload.id) {
      await api(`/api/bookings/${payload.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    }
    resetForm();
    await loadDashboard({ refreshStaff: true });
  } catch (e) {
    $('#formError').textContent = e.message;
  }
});

staffForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#staffError').textContent = '';
  const fd = new FormData(staffForm);
  const payload = {
    username: fd.get('username'),
    name: fd.get('name'),
    password: fd.get('password'),
    role: fd.get('role'),
  };
  try {
    await api('/api/staff', { method: 'POST', body: JSON.stringify(payload) });
    staffForm.reset();
    await loadStaff();
  } catch (e) {
    $('#staffError').textContent = e.message;
  }
});

$('#resetForm').addEventListener('click', resetForm);
bookingForm.elements.zone.addEventListener('change', () => syncSeatOptions());
bookingForm.elements.durationMinutes.addEventListener('change', syncComboAvailability);
$('#prevDay').addEventListener('click', () => shiftDay(-1));
$('#nextDay').addEventListener('click', () => shiftDay(1));
$('#todayBtn').addEventListener('click', () => {
  state.date = todayLocal();
  resetBookingSnapshot();
  resetForm();
  loadDashboard({ refreshStaff: true }).catch((e) => ($('#formError').textContent = e.message));
});
dateInput.addEventListener('change', () => {
  state.date = dateInput.value;
  resetBookingSnapshot();
  resetForm();
  loadDashboard({ refreshStaff: true }).catch((e) => ($('#formError').textContent = e.message));
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  showLogin();
});
soundToggle.addEventListener('click', async () => {
  try {
    if (state.soundEnabled) disableSound();
    else await enableSound();
  } catch (e) {
    $('#formError').textContent = e.message;
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollDashboard();
});

syncSeatOptions();
syncComboAvailability();
updateSoundButton();
loadDashboard({ refreshStaff: true }).catch(() => showLogin());
