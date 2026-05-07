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
};

const login = $('#login');
const app = $('#app');
const loginForm = $('#loginForm');
const bookingForm = $('#bookingForm');
const dateInput = $('#dateInput');
const columns = $('#columns');

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
}

function showApp() {
  login.classList.add('hidden');
  app.classList.remove('hidden');
}

function formPayload() {
  const fd = new FormData(bookingForm);
  return {
    id: fd.get('id'),
    date: state.date,
    clientName: fd.get('clientName'),
    phone: fd.get('phone'),
    zone: fd.get('zone'),
    time: fd.get('time'),
    durationMinutes: Number(fd.get('durationMinutes')),
    withCombo: fd.get('withCombo') === 'on',
    note: fd.get('note'),
  };
}

function resetForm() {
  bookingForm.reset();
  bookingForm.elements.id.value = '';
  bookingForm.elements.time.value = '15:00';
  $('#formTitle').textContent = 'Новая бронь';
  $('#formError').textContent = '';
}

function editBooking(booking) {
  bookingForm.elements.id.value = booking.id;
  bookingForm.elements.clientName.value = booking.clientName || '';
  bookingForm.elements.phone.value = booking.phone || '';
  bookingForm.elements.zone.value = booking.zone;
  bookingForm.elements.time.value = booking.time;
  bookingForm.elements.durationMinutes.value = booking.durationMinutes;
  bookingForm.elements.withCombo.checked = booking.withCombo;
  bookingForm.elements.note.value = booking.note || '';
  $('#formTitle').textContent = `Бронь #${booking.id}`;
  $('#formError').textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  card.innerHTML = `
    <strong>${escapeHtml(booking.time)} - ${escapeHtml(booking.endTime)}</strong>
    <div class="booking-meta">${Number(booking.durationMinutes || 0) / 60} ч · ${money(booking.totalPrice)} · <span><i class="dot ${sourceClass(booking.source)}"></i> ${source}</span></div>
    <div class="booking-client">${clientName}${phone ? ` · ${phone}` : ''}</div>
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

function renderDashboard(data) {
  state.dashboard = data;
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
}

async function loadDashboard() {
  const data = await api(`/api/dashboard?date=${state.date}`);
  renderDashboard(data);
}

function shiftDay(delta) {
  const d = new Date(`${state.date}T12:00:00`);
  d.setDate(d.getDate() + delta);
  state.date = d.toISOString().slice(0, 10);
  resetForm();
  loadDashboard().catch((e) => ($('#formError').textContent = e.message));
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  const fd = new FormData(loginForm);
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ user: fd.get('user'), password: fd.get('password') }),
    });
    await loadDashboard();
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
    await loadDashboard();
  } catch (e) {
    $('#formError').textContent = e.message;
  }
});

$('#resetForm').addEventListener('click', resetForm);
$('#prevDay').addEventListener('click', () => shiftDay(-1));
$('#nextDay').addEventListener('click', () => shiftDay(1));
$('#todayBtn').addEventListener('click', () => {
  state.date = todayLocal();
  resetForm();
  loadDashboard().catch((e) => ($('#formError').textContent = e.message));
});
dateInput.addEventListener('change', () => {
  state.date = dateInput.value;
  resetForm();
  loadDashboard().catch((e) => ($('#formError').textContent = e.message));
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

loadDashboard().catch(() => showLogin());
