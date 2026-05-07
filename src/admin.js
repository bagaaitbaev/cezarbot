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
  getAllClientsForExport,
  isBookedStatus,
  openDb,
  setBookingStatus,
  sourceLabel,
  updateBooking,
  upsertUserPhone,
  insertBooking,
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
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'cezar2026';
const sessionSecret = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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

function sessionToken() {
  return crypto.createHash('sha256').update(`${adminUser}:${adminPassword}:${sessionSecret}`).digest('hex');
}

function isAuthed(req) {
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some((x) => x.trim() === `cezar_admin=${sessionToken()}`);
}

function setAuthCookie(res) {
  res.setHeader('Set-Cookie', `cezar_admin=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'cezar_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function localIso(date, time) {
  const parsed = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', TZ);
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
    endTime: start.add(Number(booking.duration_minutes || 0), 'minute').format('HH:mm'),
    withCombo: booking.with_combo === 1,
    totalPrice: Number(booking.total_price || 0),
    promoCode: booking.promo_code || '',
    note: booking.note || '',
    clientName: user.telegram_name || 'Клиент',
    phone: user.phone || '',
    userId: booking.user_id,
  };
}

function listBookings(date) {
  const { start, end } = localDateRange(date);
  return db.bookings
    .filter((b) => b.start_datetime >= start && b.start_datetime < end)
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
    const bookingEnd = bookingStart + Number(booking.duration_minutes || 0) * 60_000;
    return startMs < bookingEnd && bookingStart < endMs;
  });
  if (seatBusy) return { ok: false, error: `Место ${seat} уже занято на это время.` };
  return { ok: true, startIso, zone, seat, durationMinutes, withCombo };
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function createManualBooking(payload) {
  const valid = validateBookingPayload(payload);
  if (!valid.ok) return valid;
  const phone = normalizePhone(payload.phone);
  const userId = phone ? `admin:${phone}` : `admin:guest:${Date.now()}`;
  upsertUserPhone(db, userId, String(payload.clientName || 'Ручная бронь').trim() || 'Ручная бронь', phone, { phoneSource: 'manual' });
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
  });
  return { ok: true, booking: bookingView(booking) };
}

function updateExistingBooking(id, payload) {
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
  };
  const phone = normalizePhone(payload.phone);
  if (phone || payload.clientName) {
    upsertUserPhone(db, existing.user_id, String(payload.clientName || '').trim() || undefined, phone, { phoneSource: phone ? 'manual' : undefined });
  }
  const result = updateBooking(db, id, patch);
  return result.ok ? { ok: true, booking: bookingView(result.booking) } : { ok: false, error: 'Не удалось обновить бронь.' };
}

function dashboard(date) {
  const bookings = listBookings(date);
  const active = bookings.filter((b) => isBookedStatus(b.status));
  return {
    date,
    zones: ZONES,
    capacity: ZONE_CAPACITY,
    bookings,
    stats: {
      active: active.length,
      revenue: active.reduce((sum, b) => sum + b.totalPrice, 0),
      telegram: active.filter((b) => b.source === 'Telegram').length,
      whatsapp: active.filter((b) => b.source === 'WhatsApp').length,
      staff: active.filter((b) => b.source === 'Сотрудник').length,
    },
  };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.user === adminUser && body.password === adminPassword) {
      setAuthCookie(res);
      return json(res, 200, { ok: true });
    }
    return json(res, 401, { ok: false, error: 'Неверный логин или пароль.' });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    clearAuthCookie(res);
    return json(res, 200, { ok: true });
  }
  if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'Нужен вход.' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/api/me') return json(res, 200, { ok: true, user: adminUser });
  if (pathname === '/api/dashboard') return json(res, 200, dashboard(url.searchParams.get('date') || dayjs().tz(TZ).format('YYYY-MM-DD')));
  if (pathname === '/api/bookings' && req.method === 'POST') return json(res, 200, createManualBooking(await readBody(req)));
  const bookingMatch = pathname.match(/^\/api\/bookings\/(\d+)$/);
  if (bookingMatch && req.method === 'PATCH') return json(res, 200, updateExistingBooking(bookingMatch[1], await readBody(req)));
  if (bookingMatch && req.method === 'DELETE') {
    const result = setBookingStatus(db, bookingMatch[1], 'cancelled');
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
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
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
