import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, '..', 'data', 'store.json');

function resolvePath() {
  return process.env.DB_PATH || defaultPath;
}

function emptyStore() {
  return { version: 1, users: {}, bookings: [], nextBookingId: 1, promo_codes: [], pending_registrations: [] };
}

function persist(db) {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(db, null, 2), 'utf8');
}

function isBookedStatus(status) {
  // backward compatibility: older data used 'confirmed'
  return status === 'booked' || status === 'confirmed';
}

/** JSON-файл как база данных */
export function openDb() {
  const p = resolvePath();
  let db;
  if (fs.existsSync(p)) {
    try {
      db = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      db = emptyStore();
    }
  } else {
    db = emptyStore();
  }
  if (!db.users || typeof db.users !== 'object') db.users = {};
  if (!Array.isArray(db.bookings)) db.bookings = [];
  if (typeof db.nextBookingId !== 'number' || db.nextBookingId < 1) db.nextBookingId = 1;
  if (!Array.isArray(db.promo_codes)) db.promo_codes = [];
  if (!Array.isArray(db.pending_registrations)) db.pending_registrations = [];
  persist(db);
  return db;
}

export function upsertUserPhone(db, userId, telegramName, phone) {
  const existing = db.users[String(userId)] ?? {};
  db.users[String(userId)] = {
    ...existing,
    user_id: userId,
    telegram_name: telegramName ?? existing.telegram_name ?? '',
    phone: phone ?? existing.phone ?? '',
    updated_at: new Date().toISOString(),
  };
  persist(db);
}

export function upsertUserLang(db, userId, lang) {
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
  return db.users[String(userId)] ?? null;
}

export function insertBooking(
  db,
  { userId, zone, startDatetimeIso, durationMinutes, withCombo, totalPrice, promoCode = null },
) {
  const id = db.nextBookingId++;
  const booking = {
    id,
    user_id: userId,
    zone,
    start_datetime: startDatetimeIso,
    duration_minutes: durationMinutes,
    with_combo: withCombo ? 1 : 0,
    total_price: totalPrice,
    promo_code: promoCode || null,
    status: 'booked',
    reminder_sent: 0,
    review_2gis_eligible: 1,
    review_2gis_sent: 0,
    created_at: new Date().toISOString(),
  };
  db.bookings.push(booking);
  persist(db);
  return booking;
}

export function setUserPromoPending(db, userId, promoCode) {
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
  return db.promo_codes
    .filter((p) => !p.disabled && !p.used_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

export function disablePromoCode(db, code) {
  const row = findPromoCode(db, code);
  if (!row) return { ok: false, reason: 'not_found' };
  row.disabled = true;
  persist(db);
  return { ok: true };
}

export function markPromoUsed(db, code, userId) {
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
  const rows = db.bookings.filter((b) => b.zone === zone && isBookedStatus(b.status));
  let count = 0;
  let earliestEndMs = null;
  for (const row of rows) {
    if (excludeId != null && Number(row.id) === Number(excludeId)) continue;
    const s = new Date(row.start_datetime).getTime();
    const e = s + row.duration_minutes * 60 * 1000;
    if (startMs < e && s < endMs) {
      count++;
      if (earliestEndMs === null || e < earliestEndMs) earliestEndMs = e;
    }
  }
  return { count, earliestEndMs };
}

export function listUpcomingBookings(db, userId) {
  const now = new Date().toISOString();
  return db.bookings
    .filter((b) => b.user_id === userId && isBookedStatus(b.status) && b.start_datetime >= now)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .slice(0, 20);
}

export function getLastBooking(db, userId) {
  const list = db.bookings.filter((b) => b.user_id === userId && isBookedStatus(b.status));
  if (!list.length) return null;
  return list.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function markReminderSent(db, bookingId) {
  const b = db.bookings.find((x) => x.id === bookingId);
  if (b) b.reminder_sent = 1;
  persist(db);
}

export function getBookingsNeedingReminder(db) {
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
  const now = Date.now();
  return db.bookings.filter((b) => {
    if (!isBookedStatus(b.status)) return false;
    if (b.review_2gis_eligible !== 1) return false;
    if (b.review_2gis_sent !== 0) return false;
    const start = new Date(b.start_datetime).getTime();
    const end = start + b.duration_minutes * 60 * 1000;
    return now >= end + REVIEW_2GIS_DELAY_MS;
  });
}

export function markReview2gisSent(db, bookingId) {
  const b = db.bookings.find((x) => x.id === bookingId);
  if (b) b.review_2gis_sent = 1;
  persist(db);
}

export function getStatsForPeriod(db, startIso, endIso) {
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
  db.bookings = [];
  db.nextBookingId = 1;
  persist(db);
}

export function cancelBooking(db, bookingId, userId) {
  const b = db.bookings.find((x) => Number(x.id) === Number(bookingId));
  if (!b) return { ok: false, reason: 'not_found' };
  if (Number(b.user_id) !== Number(userId)) return { ok: false, reason: 'forbidden' };
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
        durationMinutes: b.duration_minutes,
        withCombo: b.with_combo,
        totalPrice: b.total_price,
        promoCode: b.promo_code ?? null,
      };
    });
}

/** Сохранить попытку регистрации пользователя */
export function saveRegistrationAttempt(db, userId, telegramName) {
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
  return db.pending_registrations.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Получить список незавершённых регистраций */
export function getIncompleteRegistrations(db) {
  return db.pending_registrations
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
