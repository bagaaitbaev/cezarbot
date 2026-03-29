import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, '..', 'data', 'store.json');

function resolvePath() {
  return process.env.DB_PATH || defaultPath;
}

function emptyStore() {
  return { version: 1, users: {}, bookings: [], nextBookingId: 1 };
}

function persist(db) {
  const p = resolvePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(db, null, 2), 'utf8');
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
  { userId, zone, startDatetimeIso, durationMinutes, withCombo, totalPrice },
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
    status: 'confirmed',
    reminder_sent: 0,
    review_2gis_eligible: 1,
    review_2gis_sent: 0,
    created_at: new Date().toISOString(),
  };
  db.bookings.push(booking);
  persist(db);
  return booking;
}

/** Расталған броньдар: басталу уақыты [startIso, endIso] аралығында */
export function listConfirmedBookingsInRange(db, startIso, endIso) {
  return db.bookings
    .filter(
      (b) =>
        b.status === 'confirmed' &&
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
  const rows = db.bookings.filter((b) => b.zone === zone && b.status === 'confirmed');
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
    .filter((b) => b.user_id === userId && b.status === 'confirmed' && b.start_datetime >= now)
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .slice(0, 20);
}

export function getLastBooking(db, userId) {
  const list = db.bookings.filter((b) => b.user_id === userId && b.status === 'confirmed');
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
    if (b.status !== 'confirmed' || b.reminder_sent !== 0) return false;
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
    if (b.status !== 'confirmed') return false;
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
      b.status === 'confirmed' &&
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
