import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, '..', 'data', 'store.json');
const dbMeta = new WeakMap();

function resolvePath() {
  return process.env.DB_PATH || defaultPath;
}

function emptyStore() {
  return {
    version: 1,
    users: {},
    bookings: [],
    nextBookingId: 1,
    promo_codes: [],
    pending_registrations: [],
    admin_staff: [],
  };
}

function normalizeStore(db) {
  if (!db || typeof db !== 'object') db = emptyStore();
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!Array.isArray(db.bookings)) db.bookings = [];
  if (typeof db.nextBookingId !== 'number' || db.nextBookingId < 1) db.nextBookingId = 1;
  if (!Array.isArray(db.promo_codes)) db.promo_codes = [];
  if (!Array.isArray(db.pending_registrations)) db.pending_registrations = [];
  if (!Array.isArray(db.admin_staff)) db.admin_staff = [];
  return db;
}

function replaceStore(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, source);
}

function readStoreFile(p) {
  if (!fs.existsSync(p)) return emptyStore();
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch {
    return null;
  }
}

function trackDb(db, p) {
  let stat = null;
  try {
    stat = fs.statSync(p);
  } catch {}
  dbMeta.set(db, {
    path: p,
    mtimeMs: stat?.mtimeMs ?? 0,
    size: stat?.size ?? 0,
  });
}

export function refreshDb(db) {
  const p = resolvePath();
  const meta = dbMeta.get(db);
  if (!meta) return db;
  let stat = null;
  try {
    stat = fs.statSync(p);
  } catch {}
  const mtimeMs = stat?.mtimeMs ?? 0;
  const size = stat?.size ?? 0;
  if (meta && meta.path === p && meta.mtimeMs === mtimeMs && meta.size === size) return db;
  const latest = readStoreFile(p);
  if (!latest) return db;
  replaceStore(db, latest);
  dbMeta.set(db, { path: p, mtimeMs, size });
  return db;
}

function persist(db) {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  trackDb(db, p);
  exportCsvFiles(db);
}

const CSV_SEP = ';';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function sourceLabel(userId) {
  const id = String(userId);
  if (id.startsWith('admin:')) return 'Сотрудник';
  return id.includes('@') ? 'WhatsApp' : 'Telegram';
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.map(csvCell).join(CSV_SEP)];
  for (const row of rows) lines.push(row.map(csvCell).join(CSV_SEP));
  fs.writeFileSync(filePath, '\uFEFF' + lines.join('\r\n'), 'utf8');
}

export function exportCsvFiles(db) {
  if (process.env.AUTO_EXPORT_CSV === '0') return;

  const dataDir = path.dirname(resolvePath());
  fs.mkdirSync(dataDir, { recursive: true });

  const users = db.users || {};
  const bookings = Array.isArray(db.bookings) ? db.bookings : [];
  const bookingRows = bookings.map((b) => {
    const u = users[String(b.user_id)] || {};
    return [
      b.id,
      sourceLabel(b.user_id),
      u.telegram_name || '',
      u.phone || '',
      b.zone,
      b.seat || '',
      b.start_datetime,
      b.duration_minutes,
      b.with_combo ? 'да' : 'нет',
      b.total_price,
      b.promo_code || '',
      b.status,
      b.created_at,
    ];
  });

  writeCsv(
    path.join(dataDir, 'bookings_export.csv'),
    [
      'Номер брони',
      'Источник',
      'Клиент',
      'Телефон',
      'Зона',
      'Место',
      'Дата и время',
      'Длительность, мин',
      'Комбо',
      'Сумма, тг',
      'Промокод',
      'Статус',
      'Создано',
    ],
    bookingRows,
  );

  const clientMap = new Map();
  for (const b of bookings.filter((x) => isBookedStatus(x.status))) {
    const u = users[String(b.user_id)] || {};
    const phone = normalizePhone(u.phone);
    const key = phone || `user:${String(b.user_id)}`;
    const existing =
      clientMap.get(key) ||
      {
        sources: new Set(),
        name: u.telegram_name || '',
        phone,
        count: 0,
        total: 0,
        lastBooking: '',
      };
    existing.sources.add(sourceLabel(b.user_id));
    existing.name = u.telegram_name || existing.name;
    existing.phone = phone || existing.phone;
    existing.count += 1;
    existing.total += Number(b.total_price || 0);
    if (!existing.lastBooking || b.start_datetime > existing.lastBooking) {
      existing.lastBooking = b.start_datetime;
    }
    clientMap.set(key, existing);
  }

  const clientRows = [...clientMap.values()]
    .sort((a, b) => (b.lastBooking || '').localeCompare(a.lastBooking || ''))
    .map((c) => [[...c.sources].join(', '), c.name, c.phone, c.count, c.lastBooking, c.total]);

  writeCsv(
    path.join(dataDir, 'clients_export.csv'),
    ['Источник', 'Клиент', 'Телефон', 'Количество броней', 'Последняя бронь', 'Всего потратил, тг'],
    clientRows,
  );
}

export function isBookedStatus(status) {
  // backward compatibility: older data used 'confirmed'
  return status === 'booked' || status === 'confirmed';
}

export function isOpenSession(booking) {
  return Boolean(booking?.open_session_started_at && !booking?.open_session_closed_at);
}

export function scheduledBookingEndMs(booking) {
  return new Date(booking.start_datetime).getTime() + Number(booking.duration_minutes || 0) * 60 * 1000;
}

export function effectiveBookingEndMs(booking) {
  if (isOpenSession(booking)) return Number.POSITIVE_INFINITY;
  const scheduledEnd = scheduledBookingEndMs(booking);
  const closedEnd = booking.open_session_closed_at ? new Date(booking.open_session_closed_at).getTime() : null;
  return closedEnd ? Math.max(scheduledEnd, closedEnd) : scheduledEnd;
}

/** JSON-файл как база данных */
export function openDb() {
  const p = resolvePath();
  const db = readStoreFile(p) || emptyStore();
  trackDb(db, p);
  persist(db);
  return db;
}

export function listStaffAccounts(db, { includeDisabled = false } = {}) {
  refreshDb(db);
  return (db.admin_staff || [])
    .filter((staff) => includeDisabled || !staff.disabled)
    .sort((a, b) => String(a.name || a.username).localeCompare(String(b.name || b.username), 'ru'));
}

export function getStaffAccount(db, username) {
  refreshDb(db);
  return (db.admin_staff || []).find((staff) => staff.username === username) || null;
}

export function upsertStaffAccount(db, staff) {
  refreshDb(db);
  const username = String(staff.username || '').trim();
  if (!username) return { ok: false, reason: 'empty_username' };
  const now = new Date().toISOString();
  const existing = getStaffAccount(db, username);
  if (existing) {
    existing.name = String(staff.name || existing.name || username).trim();
    existing.role = staff.role === 'admin' ? 'admin' : 'staff';
    existing.disabled = staff.disabled === true;
    if (staff.password_hash) existing.password_hash = staff.password_hash;
    existing.updated_at = now;
    persist(db);
    return { ok: true, row: existing };
  }
  const row = {
    username,
    name: String(staff.name || username).trim(),
    role: staff.role === 'admin' ? 'admin' : 'staff',
    password_hash: staff.password_hash || '',
    disabled: false,
    created_at: now,
    updated_at: now,
  };
  db.admin_staff.push(row);
  persist(db);
  return { ok: true, row };
}

export function deleteStaffAccount(db, username) {
  refreshDb(db);
  const idx = (db.admin_staff || []).findIndex((staff) => staff.username === username);
  if (idx === -1) return { ok: false, reason: 'not_found' };
  const [row] = db.admin_staff.splice(idx, 1);
  persist(db);
  return { ok: true, row };
}

export function upsertUserPhone(db, userId, telegramName, phone, options = {}) {
  refreshDb(db);
  const existing = db.users[String(userId)] ?? {};
  const cleanPhone = phone == null ? '' : String(phone).trim();
  db.users[String(userId)] = {
    ...existing,
    user_id: userId,
    telegram_name: telegramName ?? existing.telegram_name ?? '',
    phone: cleanPhone || existing.phone || '',
    phone_source: cleanPhone && options.phoneSource ? options.phoneSource : existing.phone_source,
    updated_at: new Date().toISOString(),
  };
  persist(db);
}

export function upsertUserLang(db, userId, lang) {
  refreshDb(db);
  const existing = db.users[String(userId)] ?? {};
  db.users[String(userId)] = {
    ...existing,
    user_id: userId,
    lang,
    updated_at: new Date().toISOString(),
  };
  persist(db);
}

export function getUser(db, userId) {
  refreshDb(db);
  return db.users[String(userId)] ?? null;
}

export function insertBooking(
  db,
  {
    userId,
    zone,
    seat = '',
    startDatetimeIso,
    durationMinutes,
    withCombo,
    totalPrice,
    promoCode = null,
    source = null,
    note = '',
    createdBy = '',
    createdByName = '',
  },
) {
  refreshDb(db);
  const id = db.nextBookingId++;
  const booking = {
    id,
    user_id: userId,
    zone,
    seat: seat || '',
    start_datetime: startDatetimeIso,
    duration_minutes: durationMinutes,
    with_combo: withCombo ? 1 : 0,
    total_price: totalPrice,
    promo_code: promoCode || null,
    status: 'booked',
    source: source || sourceLabel(userId),
    note: note || '',
    created_by: createdBy || '',
    created_by_name: createdByName || '',
    reminder_sent: 0,
    review_2gis_eligible: 1,
    review_2gis_sent: 0,
    created_at: new Date().toISOString(),
  };
  db.bookings.push(booking);
  persist(db);
  return booking;
}

export function updateBooking(db, bookingId, patch) {
  refreshDb(db);
  const booking = db.bookings.find((x) => Number(x.id) === Number(bookingId));
  if (!booking) return { ok: false, reason: 'not_found' };
  Object.assign(booking, patch, { updated_at: new Date().toISOString() });
  persist(db);
  return { ok: true, booking };
}

export function setBookingStatus(db, bookingId, status, metadata = {}) {
  refreshDb(db);
  const booking = db.bookings.find((x) => Number(x.id) === Number(bookingId));
  if (!booking) return { ok: false, reason: 'not_found' };
  booking.status = status;
  booking.updated_at = new Date().toISOString();
  Object.assign(booking, metadata);
  if (status === 'cancelled') booking.cancelled_at = booking.updated_at;
  if (status === 'completed') booking.completed_at = booking.updated_at;
  persist(db);
  return { ok: true, booking };
}

export function setUserPromoPending(db, userId, promoCode) {
  refreshDb(db);
  const existing = db.users[String(userId)] ?? {};
  db.users[String(userId)] = {
    ...existing,
    user_id: userId,
    promo_pending: promoCode || null,
    updated_at: new Date().toISOString(),
  };
  persist(db);
}

export function clearUserPromoPending(db, userId) {
  setUserPromoPending(db, userId, null);
}

function normalizePromoCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function findPromoCode(db, code) {
  refreshDb(db);
  const c = normalizePromoCode(code);
  if (!c) return null;
  return db.promo_codes.find((p) => String(p.code).toUpperCase() === c) ?? null;
}

export function validatePromoCode(db, code) {
  const c = normalizePromoCode(code);
  if (!c) return { ok: false, reason: 'empty' };
  const row = findPromoCode(db, c);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.disabled) return { ok: false, reason: 'disabled' };
  if (row.used_at) return { ok: false, reason: 'used' };
  return { ok: true, code: row.code };
}

export function createPromoCode(db, code, createdBy) {
  refreshDb(db);
  const c = normalizePromoCode(code);
  if (!c) return { ok: false, reason: 'empty' };
  if (findPromoCode(db, c)) return { ok: false, reason: 'exists' };
  const row = {
    code: c,
    created_at: new Date().toISOString(),
    created_by: createdBy ?? null,
    disabled: false,
    used_at: null,
    used_by: null,
  };
  db.promo_codes.push(row);
  persist(db);
  return { ok: true, row };
}

export function listActivePromoCodes(db, limit = 50) {
  refreshDb(db);
  return db.promo_codes
    .filter((p) => !p.disabled && !p.used_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function disablePromoCode(db, code) {
  refreshDb(db);
  const row = findPromoCode(db, code);
  if (!row) return { ok: false, reason: 'not_found' };
  row.disabled = true;
  persist(db);
  return { ok: true };
}

export function markPromoUsed(db, code, userId) {
  refreshDb(db);
  const row = findPromoCode(db, code);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.disabled) return { ok: false, reason: 'disabled' };
  if (row.used_at) return { ok: false, reason: 'used' };
  row.used_at = new Date().toISOString();
  row.used_by = userId ?? null;
  persist(db);
  return { ok: true };
}

/** Расталған броньдар: басталу уақыты [startIso, endIso] аралығында */
export function listConfirmedBookingsInRange(db, startIso, endIso) {
  refreshDb(db);
  return db.bookings
    .filter(
      (b) =>
        isBookedStatus(b.status) &&
        b.start_datetime >= startIso &&
        b.start_datetime <= endIso,
    )
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime));
}

/**
 * Осы уақыт аралығымен қиылысатын расталған броньдар санын және
 * ең ерте аяқталу уақытын қайтарады (орын толы болғанда кеңес үшін).
 */
export function analyzeOverlapForSlot(db, zone, startMs, endMs, excludeId = null) {
  refreshDb(db);
  const rows = db.bookings.filter((b) => b.zone === zone && isBookedStatus(b.status));
  let count = 0;
  let earliestEndMs = null;
  for (const row of rows) {
    if (excludeId != null && Number(row.id) === Number(excludeId)) continue;
    const s = new Date(row.start_datetime).getTime();
    const e = effectiveBookingEndMs(row);
    if (startMs < e && s < endMs) {
      count++;
      if (Number.isFinite(e) && (earliestEndMs === null || e < earliestEndMs)) earliestEndMs = e;
    }
  }
  return { count, earliestEndMs };
}

export function listUpcomingBookings(db, userId) {
  refreshDb(db);
  const now = new Date().toISOString();
  return db.bookings
    .filter((b) => b.user_id === userId && isBookedStatus(b.status) && b.start_datetime >= now)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .slice(0, 20);
}

export function getLastBooking(db, userId) {
  refreshDb(db);
  const list = db.bookings.filter((b) => b.user_id === userId && isBookedStatus(b.status));
  if (!list.length) return null;
  return list.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function markReminderSent(db, bookingId) {
  refreshDb(db);
  const b = db.bookings.find((x) => x.id === bookingId);
  if (b) b.reminder_sent = 1;
  persist(db);
}

export function getBookingsNeedingReminder(db) {
  refreshDb(db);
  const now = Date.now();
  const minUntil = 59 * 60 * 1000;
  const maxUntil = 61 * 60 * 1000;
  return db.bookings.filter((b) => {
    if (!isBookedStatus(b.status) || b.reminder_sent !== 0) return false;
    const start = new Date(b.start_datetime).getTime();
    const until = start - now;
    return until >= minUntil && until <= maxUntil;
  });
}

/** Жаңа броньдар ғана (review_2gis_eligible); визит аяқталғаннан 60 мин өткен */
const REVIEW_2GIS_DELAY_MS = 60 * 60 * 1000;

export function getBookingsNeedingReview2gis(db) {
  refreshDb(db);
  const now = Date.now();
  return db.bookings.filter((b) => {
    if (!isBookedStatus(b.status)) return false;
    if (b.review_2gis_eligible !== 1) return false;
    if (b.review_2gis_sent !== 0) return false;
    if (isOpenSession(b)) return false;
    const end = effectiveBookingEndMs(b);
    return now >= end + REVIEW_2GIS_DELAY_MS;
  });
}

export function markReview2gisSent(db, bookingId) {
  refreshDb(db);
  const b = db.bookings.find((x) => x.id === bookingId);
  if (b) b.review_2gis_sent = 1;
  persist(db);
}

export function getStatsForPeriod(db, startIso, endIso) {
  refreshDb(db);
  const bookings = db.bookings.filter(
    (b) =>
      isBookedStatus(b.status) &&
      b.start_datetime >= startIso &&
      b.start_datetime < endIso,
  );
  const byZone = { zal: 0, cabinet: 0, vip: 0 };
  const clients = new Set();
  let review2gisSent = 0;
  for (const b of bookings) {
    if (b.zone in byZone) byZone[b.zone]++;
    clients.add(b.user_id);
    if (b.review_2gis_sent === 1) review2gisSent++;
  }
  return {
    totalBookings: bookings.length,
    byZone,
    uniqueClients: clients.size,
    review2gisSent,
  };
}

export function resetBookings(db) {
  refreshDb(db);
  db.bookings = [];
  db.nextBookingId = 1;
  persist(db);
}

export function cancelBooking(db, bookingId, userId) {
  refreshDb(db);
  const b = db.bookings.find((x) => Number(x.id) === Number(bookingId));
  if (!b) return { ok: false, reason: 'not_found' };
  if (String(b.user_id) !== String(userId)) return { ok: false, reason: 'forbidden' };
  if (!isBookedStatus(b.status)) return { ok: false, reason: 'not_booked' };
  const nowIso = new Date().toISOString();
  if (String(b.start_datetime) < nowIso) return { ok: false, reason: 'past' };

  b.status = 'cancelled';
  b.cancelled_at = nowIso;
  persist(db);
  return { ok: true, booking: b };
}

/** Уникальные клиенты с агрегированными данными по броням — для экспорта */
export function getAllClientsForExport(db) {
  refreshDb(db);
  const booked = db.bookings.filter((b) => isBookedStatus(b.status));
  const map = {};
  for (const b of booked) {
    const uid = String(b.user_id);
    if (!map[uid]) map[uid] = { bookingCount: 0, totalSpent: 0, lastBooking: null };
    map[uid].bookingCount++;
    map[uid].totalSpent += b.total_price;
    if (!map[uid].lastBooking || b.start_datetime > map[uid].lastBooking) {
      map[uid].lastBooking = b.start_datetime;
    }
  }
  return Object.entries(map)
    .map(([uid, agg]) => {
      const user = db.users[uid] ?? {};
      return {
        name: user.telegram_name || '—',
        phone: user.phone || '—',
        bookingCount: agg.bookingCount,
        totalSpent: agg.totalSpent,
        lastBooking: agg.lastBooking,
      };
    })
    .sort((a, b) => (b.lastBooking ?? '').localeCompare(a.lastBooking ?? ''));
}

/** Все подтверждённые брони с данными клиента — для экспорта */
export function getAllBookingsForExport(db) {
  refreshDb(db);
  return db.bookings
    .filter((b) => isBookedStatus(b.status))
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .map((b) => {
      const user = db.users[String(b.user_id)] ?? {};
      return {
        id: b.id,
        startDatetime: b.start_datetime,
        name: user.telegram_name || '—',
        phone: user.phone || '—',
        zone: b.zone,
        seat: b.seat || '',
        durationMinutes: b.duration_minutes,
        withCombo: b.with_combo,
        totalPrice: b.total_price,
        promoCode: b.promo_code ?? null,
      };
    });
}

/** Сохранить попытку регистрации пользователя */
export function saveRegistrationAttempt(db, userId, telegramName) {
  refreshDb(db);
  const existing = db.pending_registrations.find((r) => r.user_id === userId);
  if (existing) {
    existing.updated_at = new Date().toISOString();
    existing.telegram_name = telegramName ?? existing.telegram_name ?? '';
    existing.status = 'pending';
  } else {
    db.pending_registrations.push({
      user_id: userId,
      telegram_name: telegramName ?? '',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });
  }
  persist(db);
}

/** Завершить регистрацию (переместить в users, удалить из pending) */
export function completeRegistration(db, userId) {
  refreshDb(db);
  const idx = db.pending_registrations.findIndex((r) => r.user_id === userId);
  if (idx !== -1) {
    const reg = db.pending_registrations[idx];
    reg.status = 'completed';
    reg.completed_at = new Date().toISOString();
    db.pending_registrations.splice(idx, 1);
    persist(db);
  }
}

/** Получить список всех попыток регистрации (завершённых и незавершённых) */
export function getPendingRegistrations(db) {
  refreshDb(db);
  return db.pending_registrations.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Получить список незавершённых регистраций */
export function getIncompleteRegistrations(db) {
  refreshDb(db);
  return db.pending_registrations
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
