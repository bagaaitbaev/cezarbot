const $ = (selector) => document.querySelector(selector);
const SOUND_STORAGE_KEY = 'cezarSoundEnabled';

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
  soundEnabled: localStorage.getItem(SOUND_STORAGE_KEY) === 'true',
  audioContext: null,
  notificationAudio: null,
  pollTimer: null,
  openSessionReminderAt: 0,
  expandedBookingIds: new Set(),
  theme: localStorage.getItem('cezarTheme') || 'light',
};

const login = $('#login');
const app = $('#app');
const loginForm = $('#loginForm');
const bookingForm = $('#bookingForm');
const staffForm = $('#staffForm');
const dateInput = $('#dateInput');
const columns = $('#columns');
const archiveBookings = $('.archive-bookings');
const completedBookings = $('#completedBookings');
const cancelledBookings = $('#cancelledBookings');
const timeTrigger = $('#timeTrigger');
const timePicker = $('#timePicker');
const themeToggle = $('#themeToggle');
const soundToggle = $('#soundToggle');
const liveStatus = $('#liveStatus');
const staffButton = $('#staffButton');
const staffModal = $('#staffModal');
const NOTIFICATION_SOUND_URL = '/sounds/siuuu.mp3';

const SEATS_BY_ZONE = {
  zal: [1, 2, 3, 4, 5],
  cabinet: [6, 7, 8],
  vip: [9, 10],
};

const TIME_OPTIONS = ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00', '03:00'];

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

function minutesSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

function durationLabel(minutes) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} мин`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function normalizeTimeInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const separated = raw.match(/^(\d{1,2})\s*[:.\-\s]\s*(\d{1,2})$/);
  let hours;
  let minutes;
  if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2]);
  } else {
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else if (digits.length === 3) {
      hours = Number(digits.slice(0, 1));
      minutes = Number(digits.slice(1));
    } else if (digits.length === 4) {
      hours = Number(digits.slice(0, 2));
      minutes = Number(digits.slice(2));
    } else {
      return '';
    }
  }
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return '';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizePhoneDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.slice(0, 11);
}

function joinPhoneChunks(digits) {
  if (!digits) return '';
  if (!digits.startsWith('7')) return digits;
  const parts = ['+7'];
  const chunks = [digits.slice(1, 4), digits.slice(4, 7), digits.slice(7, 9), digits.slice(9, 11)];
  for (const chunk of chunks) {
    if (chunk) parts.push(chunk);
  }
  return parts.join(' ');
}

function formatPhone(value) {
  return joinPhoneChunks(normalizePhoneDigits(value));
}

function cleanPhoneInput(value) {
  const raw = String(value || '');
  const hasLeadingPlus = raw.trimStart().startsWith('+');
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (!digits) return hasLeadingPlus ? '+' : '';
  return `${hasLeadingPlus ? '+' : ''}${digits}`;
}

function formatPartialPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 1 && digits.startsWith('8')) return joinPhoneChunks(`7${digits.slice(1)}`.slice(0, 11));
  if (digits.startsWith('7')) return joinPhoneChunks(digits.slice(0, 11));
  if (digits.length === 10) return joinPhoneChunks(`7${digits}`);
  if (digits.length >= 11) return formatPhone(value);
  return cleanPhoneInput(value);
}

function formatPhoneInput(value, inputType = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (inputType.startsWith('delete')) {
    if (digits.length <= 1) return '';
    return formatPartialPhone(value);
  }
  return formatPartialPhone(value);
}

function capitalizeClientName(value) {
  return String(value || '').replace(/[\p{L}]+/gu, (word) => `${word.charAt(0).toLocaleUpperCase('ru-RU')}${word.slice(1).toLocaleLowerCase('ru-RU')}`);
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
  staffButton.classList.toggle('hidden', state.user?.role !== 'admin');
}

function updateLiveStatus(text = 'Онлайн') {
  liveStatus.textContent = text;
}

function updateSoundButton() {
  soundToggle.textContent = state.soundEnabled ? 'Звук вкл' : 'Звук выкл';
  soundToggle.classList.toggle('is-on', state.soundEnabled);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  themeToggle.textContent = state.theme === 'dark' ? 'Светлая' : 'Темная';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cezarTheme', state.theme);
  applyTheme();
}

function ensureNotificationAudio() {
  if (!state.notificationAudio) {
    state.notificationAudio = new Audio(NOTIFICATION_SOUND_URL);
    state.notificationAudio.preload = 'auto';
    state.notificationAudio.volume = 0.9;
  }
}

async function enableSound({ preview = true } = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  ensureNotificationAudio();
  if (AudioCtx && !state.audioContext) state.audioContext = new AudioCtx();
  if (state.audioContext?.state === 'suspended') await state.audioContext.resume();
  state.soundEnabled = true;
  localStorage.setItem(SOUND_STORAGE_KEY, 'true');
  updateSoundButton();
  if (preview) await playNotificationSound();
}

function disableSound() {
  state.soundEnabled = false;
  localStorage.setItem(SOUND_STORAGE_KEY, 'false');
  updateSoundButton();
}

async function playNotificationSound() {
  if (!state.soundEnabled) return;
  try {
    ensureNotificationAudio();
    state.notificationAudio.pause();
    state.notificationAudio.currentTime = 0;
    await state.notificationAudio.play();
  } catch {
    playFallbackTone();
  }
}

function unlockSoundAfterGesture() {
  if (!state.soundEnabled) return;
  enableSound({ preview: false }).catch(() => {});
}

function playFallbackTone() {
  if (!state.audioContext) return;
  const ctx = state.audioContext;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  gain.connect(ctx.destination);

  for (const [offset, frequency, duration] of [
    [0, 392, 0.46],
    [0.12, 523.25, 0.5],
    [0.28, 659.25, 0.46],
  ]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, now + offset);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.18, now + offset + duration);
    osc.connect(gain);
    osc.start(now + offset);
    osc.stop(now + offset + duration);
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
    clientName: capitalizeClientName(fd.get('clientName')).trim(),
    phone: normalizePhoneDigits(fd.get('phone')),
    zone: fd.get('zone'),
    seat: fd.get('seat'),
    time: normalizeTimeInput(fd.get('time')) || fd.get('time'),
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
  bookingForm.elements.phone.value = '';
  setBookingTime('15:00');
  $('#formTitle').textContent = 'Новая бронь';
  $('#formError').textContent = '';
  syncSeatOptions();
  syncComboAvailability();
}

function editBooking(booking) {
  bookingForm.elements.id.value = booking.id;
  bookingForm.elements.clientName.value = capitalizeClientName(booking.clientName || '');
  bookingForm.elements.phone.value = formatPhone(booking.phone);
  bookingForm.elements.zone.value = booking.zone;
  syncSeatOptions(booking.seat);
  setBookingTime(booking.time);
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

function setBookingTime(value) {
  const time = normalizeTimeInput(value);
  if (!time) return false;
  bookingForm.elements.time.value = time;
  timeTrigger.querySelector('span').textContent = time;
  timePicker.querySelectorAll('[data-time]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.time === time);
  });
  const manualInput = timePicker.querySelector('[data-time-manual]');
  if (manualInput) manualInput.value = time;
  return true;
}

function openTimePicker() {
  timePicker.classList.remove('hidden');
  timeTrigger.setAttribute('aria-expanded', 'true');
  const manualInput = timePicker.querySelector('[data-time-manual]');
  if (manualInput) {
    manualInput.value = bookingForm.elements.time.value;
  }
}

function closeTimePicker() {
  timePicker.classList.add('hidden');
  timeTrigger.setAttribute('aria-expanded', 'false');
}

function renderTimePicker() {
  timePicker.innerHTML = `
    <div class="time-manual">
      <input data-time-manual type="text" inputmode="numeric" autocomplete="off" placeholder="Например 15:30" aria-label="Ввести время вручную" />
      <button class="time-manual-apply" type="button" data-time-apply>ОК</button>
    </div>
    ${TIME_OPTIONS.map(
      (time) => `<button class="time-option" type="button" role="option" data-time="${time}">${time}</button>`,
    ).join('')}
  `;
  timePicker.addEventListener('click', (event) => {
    const apply = event.target.closest('[data-time-apply]');
    if (apply) {
      const input = timePicker.querySelector('[data-time-manual]');
      if (setBookingTime(input?.value)) {
        closeTimePicker();
        return;
      }
      input?.classList.add('is-invalid');
      return;
    }
    const button = event.target.closest('[data-time]');
    if (!button) return;
    setBookingTime(button.dataset.time);
    closeTimePicker();
  });
  timePicker.querySelector('[data-time-manual]')?.addEventListener('input', (event) => {
    event.target.classList.remove('is-invalid');
  });
  timePicker.querySelector('[data-time-manual]')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (setBookingTime(event.target.value)) closeTimePicker();
    else event.target.classList.add('is-invalid');
  });
  setBookingTime(bookingForm.elements.time.value || '15:00');
}

async function cancelBooking(id) {
  if (!confirm(`Отменить бронь #${id}?`)) return;
  await api(`/api/bookings/${id}`, { method: 'DELETE' });
  await loadDashboard();
}

async function confirmArrival(id) {
  await api(`/api/bookings/${id}/arrival`, { method: 'POST' });
  await loadDashboard();
}

async function openSession(id) {
  await api(`/api/bookings/${id}/open-session`, { method: 'POST' });
  await loadDashboard();
}

async function closeSession(id) {
  if (!confirm(`Закрыть открытую сессию #${id}?`)) return;
  await api(`/api/bookings/${id}/close-session`, { method: 'POST' });
  await loadDashboard();
}

async function completeBooking(id) {
  if (!confirm(`Завершить бронь #${id}?`)) return;
  await api(`/api/bookings/${id}/complete`, { method: 'POST' });
  await loadDashboard();
}

function isActiveBooking(booking) {
  return booking.status === 'booked' || booking.status === 'confirmed';
}

function sourceClass(source) {
  if (source === 'Telegram') return 'telegram';
  if (source === 'WhatsApp') return 'whatsapp';
  return 'staff';
}

function bookingCard(booking) {
  const card = document.createElement('article');
  card.className = 'booking-card';
  const bookingId = Number(booking.id);
  const isExpanded = state.expandedBookingIds.has(bookingId);
  card.dataset.source = booking.source;
  card.dataset.status = booking.status;
  card.dataset.arrived = booking.arrivedAt ? 'true' : 'false';
  card.dataset.openSession = booking.openSessionStartedAt && !booking.openSessionClosedAt ? 'true' : 'false';
  card.dataset.expanded = isExpanded ? 'true' : 'false';
  card.setAttribute('aria-expanded', String(isExpanded));
  const source = escapeHtml(booking.source);
  const clientName = escapeHtml(booking.clientName || 'Клиент');
  const phone = escapeHtml(formatPhone(booking.phone));
  const note = escapeHtml(booking.note);
  const zoneLabel = escapeHtml(booking.zoneLabel || booking.zone);
  const seat = booking.seat ? escapeHtml(`Место ${booking.seat}`) : 'Место не выбрано';
  const arrivedBy = escapeHtml(booking.arrivedByName || booking.arrivedBy || 'сотрудник');
  const isActive = isActiveBooking(booking);
  const isOpenSession = Boolean(booking.openSessionStartedAt && !booking.openSessionClosedAt);
  const isOverdueOpenSession = isOpenSession && new Date(booking.endDatetime).getTime() <= Date.now();
  card.dataset.overdue = isOverdueOpenSession ? 'true' : 'false';
  const arrivedBadge = booking.arrivedAt ? `<span class="arrival-badge">Пришел · ${arrivedBy}</span>` : '';
  const sessionBadge = (() => {
    if (isOpenSession) {
      const extraMinutes = minutesSince(booking.endDatetime);
      const text = extraMinutes > 0 ? `Открытая сессия · +${durationLabel(extraMinutes)}` : 'Открытая сессия';
      return `<span class="session-badge ${isOverdueOpenSession ? 'is-overdue' : ''}">${escapeHtml(text)}</span>`;
    }
    if (booking.openSessionClosedAt) {
      return `<span class="session-badge">Закрыта в ${escapeHtml(booking.effectiveEndTime || booking.endTime)}</span>`;
    }
    return '';
  })();
  const actionButtons = [
    isActive && !booking.arrivedAt ? '<button class="arrival small" data-action="arrival">Пришел</button>' : '',
    isActive && !booking.openSessionClosedAt
      ? `<button class="session small" data-action="${isOpenSession ? 'closeSession' : 'openSession'}">${isOpenSession ? 'Закрыть' : 'Открыть'}</button>`
      : '',
    isActive ? '<button class="ghost small" data-action="edit">Изменить</button>' : '',
    isActive ? '<button class="complete small" data-action="complete">Завершить</button>' : '',
    isActive ? '<button class="danger small" data-action="cancel">Отменить</button>' : '',
  ].join('');
  card.innerHTML = `
    <div class="booking-summary">
      <div class="booking-summary-line">
        <strong>${escapeHtml(booking.time)} - ${escapeHtml(booking.endTime)}</strong>
        <span>${clientName}</span>
      </div>
      <span class="booking-chevron" aria-hidden="true"></span>
    </div>
    <div class="booking-details">
      <div class="booking-details-inner">
        <div class="booking-phone">Тел: ${phone || 'не указан'}</div>
        <div class="booking-badges">
          <span>${zoneLabel}</span>
          <span>${seat}</span>
          ${arrivedBadge}
          ${sessionBadge}
        </div>
        <div class="booking-meta">${Number(booking.durationMinutes || 0) / 60} ч · ${money(booking.totalPrice)} · <span><i class="dot ${sourceClass(booking.source)}"></i> ${source}</span></div>
        ${note ? `<div class="booking-client">${note}</div>` : ''}
        ${actionButtons ? `<div class="booking-actions">${actionButtons}</div>` : ''}
      </div>
    </div>
  `;
  card.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    if (action === 'arrival') {
      event.stopPropagation();
      confirmArrival(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    if (action === 'openSession') {
      event.stopPropagation();
      openSession(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    if (action === 'closeSession') {
      event.stopPropagation();
      closeSession(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    if (action === 'edit') {
      event.stopPropagation();
      editBooking(booking);
      return;
    }
    if (action === 'complete') {
      event.stopPropagation();
      completeBooking(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    if (action === 'cancel') {
      event.stopPropagation();
      cancelBooking(booking.id).catch((e) => ($('#formError').textContent = e.message));
      return;
    }
    if (state.expandedBookingIds.has(bookingId)) {
      state.expandedBookingIds.delete(bookingId);
      card.dataset.expanded = 'false';
      card.setAttribute('aria-expanded', 'false');
    } else {
      state.expandedBookingIds.add(bookingId);
      card.dataset.expanded = 'true';
      card.setAttribute('aria-expanded', 'true');
    }
  });
  return card;
}

function remindOpenSessions(bookings) {
  const overdue = bookings.filter((b) => b.openSessionStartedAt && !b.openSessionClosedAt && new Date(b.endDatetime).getTime() <= Date.now());
  if (!overdue.length) return;
  const now = Date.now();
  if (now - state.openSessionReminderAt < 15 * 60 * 1000) return;
  state.openSessionReminderAt = now;
  updateLiveStatus(`Проверьте открытую сессию #${overdue[0].id}`);
  playNotificationSound();
  setTimeout(() => updateLiveStatus('Онлайн'), 6000);
}

function renderArchiveBookings(container, bookings, title) {
  container.innerHTML = '';
  if (!bookings.length) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="cancelled-head">
      <h3>${escapeHtml(title)}</h3>
      <span>${bookings.length}</span>
    </div>
    <div class="cancelled-list"></div>
  `;
  const list = container.querySelector('.cancelled-list');
  bookings.forEach((booking) => list.append(bookingCard(booking)));
}

function renderDashboard(data, { notify = false } = {}) {
  const activeIds = new Set(data.bookings.filter(isActiveBooking).map((b) => Number(b.id)));
  const newBookings =
    notify && state.hasDashboardSnapshot
      ? data.bookings.filter((b) => isActiveBooking(b) && !state.knownBookingIds.has(Number(b.id)))
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
  $('#statOpenSessions').textContent = data.stats.openSessions || 0;
  $('#statStaff').textContent = data.stats.staff;
  columns.innerHTML = '';
  const completedRows = data.bookings.filter((b) => b.status === 'completed');
  const cancelledRows = data.bookings.filter((b) => b.status === 'cancelled');
  archiveBookings.classList.toggle('hidden', !completedRows.length && !cancelledRows.length);

  for (const zone of ['zal', 'cabinet', 'vip']) {
    const column = document.createElement('section');
    column.className = 'zone-column';
    const rows = data.bookings.filter((b) => b.zone === zone && isActiveBooking(b));
    const activeCount = rows.length;
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
  renderArchiveBookings(completedBookings, completedRows, 'Завершенные брони');
  renderArchiveBookings(cancelledBookings, cancelledRows, 'Отмененные брони');

  notifyNewBookings(newBookings);
  remindOpenSessions(data.bookings.filter(isActiveBooking));
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

function openStaffModal() {
  staffModal.classList.remove('hidden');
  staffModal.setAttribute('aria-hidden', 'false');
  loadStaff().catch((e) => ($('#staffError').textContent = e.message));
}

function closeStaffModal() {
  staffModal.classList.add('hidden');
  staffModal.setAttribute('aria-hidden', 'true');
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
bookingForm.elements.phone.addEventListener('input', (event) => {
  event.target.value = formatPhoneInput(event.target.value, event.inputType || '');
});
bookingForm.elements.phone.addEventListener('blur', (event) => {
  event.target.value = formatPhone(event.target.value);
});
bookingForm.elements.clientName.addEventListener('input', (event) => {
  event.target.value = capitalizeClientName(event.target.value);
});
bookingForm.elements.clientName.addEventListener('blur', (event) => {
  event.target.value = capitalizeClientName(event.target.value).trim();
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
  closeStaffModal();
  showLogin();
});
staffButton.addEventListener('click', openStaffModal);
$('#closeStaffModal').addEventListener('click', closeStaffModal);
staffModal.addEventListener('click', (event) => {
  if (event.target?.dataset?.close === 'staff') closeStaffModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !staffModal.classList.contains('hidden')) closeStaffModal();
  if (event.key === 'Escape') closeTimePicker();
});
soundToggle.addEventListener('click', async () => {
  try {
    if (state.soundEnabled) disableSound();
    else await enableSound();
  } catch (e) {
    $('#formError').textContent = e.message;
  }
});
themeToggle.addEventListener('click', toggleTheme);
timeTrigger.addEventListener('click', (event) => {
  event.stopPropagation();
  if (timePicker.classList.contains('hidden')) openTimePicker();
  else closeTimePicker();
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.time-field')) closeTimePicker();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollDashboard();
});
document.addEventListener('pointerdown', unlockSoundAfterGesture, { passive: true });
document.addEventListener('keydown', unlockSoundAfterGesture);

applyTheme();
renderTimePicker();
syncSeatOptions();
syncComboAvailability();
updateSoundButton();
loadDashboard({ refreshStaff: true }).catch(() => showLogin());
