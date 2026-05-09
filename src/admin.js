import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { ZONE_CAPACITY, ZONES } from './config.js';
import { getPrice } from './pricing.js';
import {
  analyzeOverlapForSlot,
  effectiveBookingEndMs,
  getAllClientsForExport,
  getStaffAccount,
  isBookedStatus,
  isOpenSession,
  listStaffAccounts,
  openDb,
  refreshDb,
  deleteStaffAccount,
  setBookingStatus,
  sourceLabel,
  updateBooking,
  upsertUserPhone,
  insertBooking,
  upsertStaffAccount,
} from './db.js';
import { validateBookingFitsClosing } from './utils/time.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public', 'admin');
const TZ = process.env.TZ || 'Asia/Almaty';
const SEATS_BY_ZONE = {
  zal: ['1', '2', '3', '4', '5'],
  cabinet: ['6', '7', '8'],
  vip: ['9', '10'],
};

loadEnvFile();
process.env.DB_PATH ||= path.join(projectRoot, 'data', 'store.json');

const db = openDb();
const port = Number(process.env.ADMIN_PORT || 3000);
const sessionSecret = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
seedStaffAccounts();

function loadEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] ??= val;
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseEnvAdminUsers() {
  const raw = process.env.ADMIN_USERS?.trim();
  const fallbackUser = process.env.ADMIN_USER || 'admin';
  const fallbackPassword = process.env.ADMIN_PASSWORD || 'cezar2026';
  if (!raw) {
    return [
      {
        username: fallbackUser,
        password: fallbackPassword,
        name: fallbackUser,
        role: 'admin',
      },
    ];
  }

  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [username, password, name = username, role = 'staff'] = entry.split(':').map((x) => x.trim());
      return username && password ? { username, password, name, role } : null;
    })
    .filter(Boolean);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, iterationsRaw, salt, expected] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !iterationsRaw || !salt || !expected) return false;
  const iterations = Number(iterationsRaw);
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, 32, 'sha256').toString('base64url');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function seedStaffAccounts() {
  if (listStaffAccounts(db, { includeDisabled: true }).length) return;
  for (const user of parseEnvAdminUsers()) {
    upsertStaffAccount(db, {
      username: user.username,
      name: user.name,
      role: user.role,
      password_hash: hashPassword(user.password),
    });
  }
}

function findActiveStaff(username) {
  const staff = getStaffAccount(db, username);
  return staff && !staff.disabled ? staff : null;
}

function publicUser(user) {
  if (!user) return null;
  return { username: user.username, name: user.name, role: user.role };
}

function signPayload(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function sessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      user: user.username,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }),
  ).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

function sessionUser(req) {
  const cookie = req.headers.cookie || '';
  const raw = cookie
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('cezar_admin='))
    ?.slice('cezar_admin='.length);
  if (!raw) return null;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || signPayload(payload) !== signature) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.user || Number(parsed.exp || 0) < Date.now()) return null;
    return findActiveStaff(parsed.user);
  } catch {
    return null;
  }
}

function setAuthCookie(res, user) {
  res.setHeader('Set-Cookie', `cezar_admin=${sessionToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'cezar_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
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

function localIso(date, time) {
  const normalizedTime = normalizeTimeInput(time);
  if (!normalizedTime) return null;
  const parsed = dayjs.tz(`${date} ${normalizedTime}`, 'YYYY-MM-DD HH:mm', TZ);
  if (!parsed.isValid()) return null;
  return parsed.second(0).millisecond(0).toISOString();
}

function localDateRange(date) {
  const d = dayjs.tz(date, 'YYYY-MM-DD', TZ);
  return { start: d.startOf('day').toISOString(), end: d.add(1, 'day').startOf('day').toISOString() };
}

function bookingView(booking) {
  const user = db.users[String(booking.user_id)] || {};
  const start = dayjs(booking.start_datetime).tz(TZ);
  const effectiveEndMs = effectiveBookingEndMs(booking);
  return {
    id: booking.id,
    source: booking.source || sourceLabel(booking.user_id),
    status: booking.status,
    zone: booking.zone,
    zoneLabel: ZONES[booking.zone]?.label || booking.zone,
    seat: booking.seat || '',
    date: start.format('YYYY-MM-DD'),
    time: start.format('HH:mm'),
    startDatetime: booking.start_datetime,
    durationMinutes: booking.duration_minutes,
    endDatetime: start.add(Number(booking.duration_minutes || 0), 'minute').toISOString(),
    endTime: start.add(Number(booking.duration_minutes || 0), 'minute').format('HH:mm'),
    effectiveEndTime: Number.isFinite(effectiveEndMs) ? dayjs(effectiveEndMs).tz(TZ).format('HH:mm') : '',
    withCombo: booking.with_combo === 1,
    totalPrice: Number(booking.total_price || 0),
    promoCode: booking.promo_code || '',
    note: booking.note || '',
    createdBy: booking.created_by || '',
    createdByName: booking.created_by_name || '',
    updatedBy: booking.updated_by || '',
    updatedByName: booking.updated_by_name || '',
    cancelledBy: booking.cancelled_by || '',
    cancelledByName: booking.cancelled_by_name || '',
    completedAt: booking.completed_at || '',
    completedBy: booking.completed_by || '',
    completedByName: booking.completed_by_name || '',
    arrivedAt: booking.arrived_at || '',
    arrivedBy: booking.arrived_by || '',
    arrivedByName: booking.arrived_by_name || '',
    openSessionStartedAt: booking.open_session_started_at || '',
    openSessionStartedBy: booking.open_session_started_by || '',
    openSessionStartedByName: booking.open_session_started_by_name || '',
    openSessionClosedAt: booking.open_session_closed_at || '',
    openSessionClosedBy: booking.open_session_closed_by || '',
    openSessionClosedByName: booking.open_session_closed_by_name || '',
    actualDurationMinutes: booking.actual_duration_minutes || '',
    clientName: user.telegram_name || 'Клиент',
    phone: user.phone || '',
    userId: booking.user_id,
  };
}

function listBookings(date) {
  refreshDb(db);
  const { start, end } = localDateRange(date);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return db.bookings
    .filter((b) => {
      if (!isBookedStatus(b.status)) return b.start_datetime >= start && b.start_datetime < end;
      const bookingStart = new Date(b.start_datetime).getTime();
      return bookingStart < endMs && effectiveBookingEndMs(b) > startMs;
    })
    .sort((a, b) => a.start_datetime.localeCompare(b.start_datetime))
    .map(bookingView);
}

function validateBookingPayload(payload, excludeId = null) {
  const zone = String(payload.zone || '');
  const seat = String(payload.seat || '').replace(/\D/g, '');
  const durationMinutes = Number(payload.durationMinutes || 0);
  const withCombo = durationMinutes === 60 ? false : Boolean(payload.withCombo);
  const startIso = localIso(payload.date, payload.time);
  if (!ZONES[zone]) return { ok: false, error: 'Выберите зону.' };
  if (!SEATS_BY_ZONE[zone]?.includes(seat)) return { ok: false, error: 'Выберите место для этой зоны.' };
  if (!startIso) return { ok: false, error: 'Проверьте дату и время.' };
  if (![60, 180, 300].includes(durationMinutes)) return { ok: false, error: 'Выберите длительность.' };
  const closing = validateBookingFitsClosing(startIso, durationMinutes, 'ru');
  if (!closing.ok) return { ok: false, error: closing.error };
  const startMs = new Date(startIso).getTime();
  const endMs = startMs + durationMinutes * 60_000;
  const overlap = analyzeOverlapForSlot(db, zone, startMs, endMs, excludeId);
  if (overlap.count >= (ZONE_CAPACITY[zone] || 1)) return { ok: false, error: 'На это время мест уже нет.' };
  const seatBusy = db.bookings.some((booking) => {
    if (excludeId != null && Number(booking.id) === Number(excludeId)) return false;
    if (!isBookedStatus(booking.status)) return false;
    if (booking.zone !== zone || String(booking.seat || '') !== seat) return false;
    const bookingStart = new Date(booking.start_datetime).getTime();
    const bookingEnd = effectiveBookingEndMs(booking);
    return startMs < bookingEnd && bookingStart < endMs;
  });
  if (seatBusy) return { ok: false, error: `Место ${seat} уже занято на это время.` };
  return { ok: true, startIso, zone, seat, durationMinutes, withCombo };
}

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  return digits.slice(0, 11);
}

function normalizeClientName(name) {
  return String(name || '')
    .trim()
    .replace(/[\p{L}]+/gu, (word) => `${word.charAt(0).toLocaleUpperCase('ru-RU')}${word.slice(1).toLocaleLowerCase('ru-RU')}`);
}

function actorFields(actor, prefix) {
  return {
    [`${prefix}_by`]: actor?.username || '',
    [`${prefix}_by_name`]: actor?.name || actor?.username || '',
    [`${prefix}_at`]: new Date().toISOString(),
  };
}

function createManualBooking(payload, actor) {
  const valid = validateBookingPayload(payload);
  if (!valid.ok) return valid;
  const phone = normalizePhone(payload.phone);
  const userId = phone ? `admin:${phone}` : `admin:guest:${Date.now()}`;
  upsertUserPhone(db, userId, normalizeClientName(payload.clientName) || 'Ручная бронь', phone, { phoneSource: 'manual' });
  const total = getPrice(valid.zone, valid.durationMinutes, valid.withCombo) || 0;
  const booking = insertBooking(db, {
    userId,
    zone: valid.zone,
    seat: valid.seat,
    startDatetimeIso: valid.startIso,
    durationMinutes: valid.durationMinutes,
    withCombo: valid.withCombo,
    totalPrice: total,
    source: 'Сотрудник',
    note: String(payload.note || '').trim(),
    createdBy: actor?.username || '',
    createdByName: actor?.name || actor?.username || '',
  });
  return { ok: true, booking: bookingView(booking) };
}

function updateExistingBooking(id, payload, actor) {
  refreshDb(db);
  const existing = db.bookings.find((b) => Number(b.id) === Number(id));
  if (!existing || !isBookedStatus(existing.status)) return { ok: false, error: 'Бронь не найдена.' };
  const valid = validateBookingPayload(payload, id);
  if (!valid.ok) return valid;
  const total = getPrice(valid.zone, valid.durationMinutes, valid.withCombo) || Number(existing.total_price || 0);
  const patch = {
    zone: valid.zone,
    seat: valid.seat,
    start_datetime: valid.startIso,
    duration_minutes: valid.durationMinutes,
    with_combo: valid.withCombo ? 1 : 0,
    total_price: total,
    note: String(payload.note || '').trim(),
    ...actorFields(actor, 'updated'),
  };
  const phone = normalizePhone(payload.phone);
  if (phone || payload.clientName) {
    upsertUserPhone(db, existing.user_id, normalizeClientName(payload.clientName) || undefined, phone, { phoneSource: phone ? 'manual' : undefined });
  }
  const result = updateBooking(db, id, patch);
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось обновить бронь.' };
}

function confirmBookingArrival(id, actor) {
  refreshDb(db);
  const existing = db.bookings.find((b) => Number(b.id) === Number(id));
  if (!existing || !isBookedStatus(existing.status)) return { ok: false, error: 'Бронь не найдена.' };
  const result = updateBooking(db, id, actorFields(actor, 'arrived'));
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось подтвердить приход клиента.' };
}

function openBookingSession(id, actor) {
  refreshDb(db);
  const existing = db.bookings.find((b) => Number(b.id) === Number(id));
  if (!existing || !isBookedStatus(existing.status)) return { ok: false, error: 'Бронь не найдена.' };
  if (isOpenSession(existing)) return { ok: true, booking: bookingView(existing) };
  const result = updateBooking(db, id, actorFields(actor, 'open_session_started'));
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось открыть сессию.' };
}

function closeBookingSession(id, actor) {
  refreshDb(db);
  const existing = db.bookings.find((b) => Number(b.id) === Number(id));
  if (!existing || !isBookedStatus(existing.status)) return { ok: false, error: 'Бронь не найдена.' };
  if (!isOpenSession(existing)) return { ok: false, error: 'Открытая сессия не найдена.' };
  const nowIso = new Date().toISOString();
  const startMs = new Date(existing.start_datetime).getTime();
  const actualDurationMinutes = Math.max(Number(existing.duration_minutes || 0), Math.ceil((Date.now() - startMs) / 60_000));
  const result = updateBooking(db, id, {
    open_session_closed_at: nowIso,
    open_session_closed_by: actor?.username || '',
    open_session_closed_by_name: actor?.name || actor?.username || '',
    actual_duration_minutes: actualDurationMinutes,
  });
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось закрыть сессию.' };
}

function completeBooking(id, actor) {
  refreshDb(db);
  const existing = db.bookings.find((b) => Number(b.id) === Number(id));
  if (!existing || !isBookedStatus(existing.status)) return { ok: false, error: 'Бронь не найдена.' };
  const nowIso = new Date().toISOString();
  const startMs = new Date(existing.start_datetime).getTime();
  const actualDurationMinutes = Math.max(1, Math.ceil((Date.now() - startMs) / 60_000));
  const result = setBookingStatus(db, id, 'completed', {
    completed_by: actor?.username || '',
    completed_by_name: actor?.name || actor?.username || '',
    completed_at: nowIso,
    actual_duration_minutes: actualDurationMinutes,
    ...(isOpenSession(existing)
      ? {
          open_session_closed_at: nowIso,
          open_session_closed_by: actor?.username || '',
          open_session_closed_by_name: actor?.name || actor?.username || '',
        }
      : {}),
  });
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось завершить бронь.' };
}

function dashboard(date) {
  const bookings = listBookings(date);
  const active = bookings.filter((b) => isBookedStatus(b.status));
  refreshDb(db);
  const recentBookings = db.bookings
    .filter((b) => isBookedStatus(b.status))
    .sort((a, b) => {
      const createdDiff = String(a.created_at || '').localeCompare(String(b.created_at || ''));
      return createdDiff || Number(a.id || 0) - Number(b.id || 0);
    })
    .slice(-50)
    .map(bookingView);
  return {
    date,
    zones: ZONES,
    capacity: ZONE_CAPACITY,
    bookings,
    recentBookings,
    stats: {
      active: active.length,
      revenue: active.reduce((sum, b) => sum + b.totalPrice, 0),
      telegram: active.filter((b) => b.source === 'Telegram').length,
      whatsapp: active.filter((b) => b.source === 'WhatsApp').length,
      staff: active.filter((b) => b.source === 'Сотрудник').length,
      openSessions: active.filter((b) => b.openSessionStartedAt && !b.openSessionClosedAt).length,
    },
  };
}

function saveStaffFromRequest(payload, actor) {
  const username = String(payload.username || '').trim();
  const name = String(payload.name || username).trim();
  const role = payload.role === 'admin' ? 'admin' : 'staff';
  const password = String(payload.password || '');
  if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return { ok: false, error: 'Логин должен быть 3-32 символа: латиница, цифры, точка, дефис или нижнее подчеркивание.' };
  }
  const existing = getStaffAccount(db, username);
  if (!existing && password.length < 4) return { ok: false, error: 'Укажите пароль минимум 4 символа.' };
  if (existing && existing.username === actor.username && role !== 'admin') {
    return { ok: false, error: 'Нельзя снять роль администратора у самого себя.' };
  }
  const result = upsertStaffAccount(db, {
    username,
    name,
    role,
    password_hash: password ? hashPassword(password) : undefined,
  });
  if (!result.ok) return { ok: false, error: 'Не удалось сохранить сотрудника.' };
  return { ok: true, staff: publicUser(result.row) };
}

function removeStaffFromRequest(username, actor) {
  const target = getStaffAccount(db, username);
  if (!target) return { ok: false, error: 'Сотрудник не найден.' };
  if (target.username === actor.username) return { ok: false, error: 'Нельзя удалить самого себя.' };
  const activeAdmins = listStaffAccounts(db).filter((staff) => staff.role === 'admin');
  if (target.role === 'admin' && activeAdmins.length <= 1) {
    return { ok: false, error: 'Нельзя удалить последнего администратора.' };
  }
  const result = deleteStaffAccount(db, username);
  return result.ok ? { ok: true } : { ok: false, error: 'Не удалось удалить сотрудника.' };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const user = findActiveStaff(String(body.user || '').trim());
    if (user && verifyPassword(body.password, user.password_hash)) {
      setAuthCookie(res, user);
      return json(res, 200, { ok: true, user: publicUser(user) });
    }
    return json(res, 401, { ok: false, error: 'Неверный логин или пароль.' });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    clearAuthCookie(res);
    return json(res, 200, { ok: true });
  }
  const actor = sessionUser(req);
  if (!actor) return json(res, 401, { ok: false, error: 'Нужен вход.' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/api/me') return json(res, 200, { ok: true, user: publicUser(actor) });
  if (pathname === '/api/staff' && req.method === 'GET') {
    if (actor.role !== 'admin') return json(res, 403, { ok: false, error: 'Недостаточно прав.' });
    return json(res, 200, { ok: true, staff: listStaffAccounts(db).map(publicUser) });
  }
  if (pathname === '/api/staff' && req.method === 'POST') {
    if (actor.role !== 'admin') return json(res, 403, { ok: false, error: 'Недостаточно прав.' });
    return json(res, 200, saveStaffFromRequest(await readBody(req), actor));
  }
  const staffMatch = pathname.match(/^\/api\/staff\/([^/]+)$/);
  if (staffMatch && req.method === 'DELETE') {
    if (actor.role !== 'admin') return json(res, 403, { ok: false, error: 'Недостаточно прав.' });
    return json(res, 200, removeStaffFromRequest(decodeURIComponent(staffMatch[1]), actor));
  }
  if (pathname === '/api/dashboard') return json(res, 200, dashboard(url.searchParams.get('date') || dayjs().tz(TZ).format('YYYY-MM-DD')));
  if (pathname === '/api/bookings' && req.method === 'POST') return json(res, 200, createManualBooking(await readBody(req), actor));
  const bookingArrivalMatch = pathname.match(/^\/api\/bookings\/(\d+)\/arrival$/);
  if (bookingArrivalMatch && req.method === 'POST') return json(res, 200, confirmBookingArrival(bookingArrivalMatch[1], actor));
  const bookingOpenSessionMatch = pathname.match(/^\/api\/bookings\/(\d+)\/open-session$/);
  if (bookingOpenSessionMatch && req.method === 'POST') return json(res, 200, openBookingSession(bookingOpenSessionMatch[1], actor));
  const bookingCloseSessionMatch = pathname.match(/^\/api\/bookings\/(\d+)\/close-session$/);
  if (bookingCloseSessionMatch && req.method === 'POST') return json(res, 200, closeBookingSession(bookingCloseSessionMatch[1], actor));
  const bookingCompleteMatch = pathname.match(/^\/api\/bookings\/(\d+)\/complete$/);
  if (bookingCompleteMatch && req.method === 'POST') return json(res, 200, completeBooking(bookingCompleteMatch[1], actor));
  const bookingMatch = pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (bookingMatch && req.method === 'PATCH') return json(res, 200, updateExistingBooking(bookingMatch[1], await readBody(req), actor));
  if (bookingMatch && req.method === 'DELETE') {
    const result = setBookingStatus(db, bookingMatch[1], 'cancelled', actorFields(actor, 'cancelled'));
    return json(res, result.ok ? 200 : 404, result.ok ? { ok: true } : { ok: false, error: 'Бронь не найдена.' });
  }
  if (pathname === '/api/clients') return json(res, 200, { ok: true, clients: getAllClientsForExport(db).slice(0, 200) });
  return json(res, 404, { ok: false, error: 'Не найдено.' });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const fullPath = path.resolve(publicDir, requested);
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const filePath = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? fullPath : path.join(publicDir, 'index.html');
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.png': 'image/png',
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((e) => json(res, 500, { ok: false, error: e?.message || 'Ошибка сервера.' }));
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[CEZAR Admin] Listening on http://0.0.0.0:${port}`);
});
