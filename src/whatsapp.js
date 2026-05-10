import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
import { fileURLToPath } from 'url';
import { openDb } from './db.js';
import {
  analyzeOverlapForSlot,
  cancelBooking,
  clearUserPromoPending,
  completeRegistration,
  getAllBookingsForExport,
  getAllClientsForExport,
  getIncompleteRegistrations,
  getLastBooking,
  getStatsForPeriod,
  getUser,
  insertBooking,
  isBookedStatus,
  listActivePromoCodes,
  listConfirmedBookingsInRange,
  listUpcomingBookings,
  markManualWhatsAppConfirmationFailed,
  markManualWhatsAppConfirmationSent,
  markPromoUsed,
  resetBookings,
  refreshDb,
  saveRegistrationAttempt,
  setUserPromoPending,
  upsertUserLang,
  upsertUserPhone,
  validatePromoCode,
} from './db.js';
import { BASE_PRICES, QUICK_HOURS, ZONE_CAPACITY, ZONES } from './config.js';
import { getPrice } from './pricing.js';
import {
  formatKzDateTime,
  getLocalDayRangeIso,
  getMonthRangeIso,
  getWeekRangeIso,
  isValidTimeFormat,
  minutesLabel,
  resolveBookingDateTime,
  validateBookingFitsClosing,
} from './utils/time.js';

const { Client, LocalAuth } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const SESSION_FILE = path.join(projectRoot, 'data', 'whatsapp-sessions.json');
const QR_IMAGE_FILE = path.join(projectRoot, 'data', 'whatsapp-qr.png');
const DEFAULT_WA_WEB_VERSION_URL =
  'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1039181464-alpha.html';

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function emptyDraft() {
  return { zone: null, startIso: null, durationMin: null, withCombo: null, repeatMode: false };
}

function loadSessions() {
  if (!fs.existsSync(SESSION_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

const sessions = loadSessions();

function getSession(userId) {
  const key = String(userId);
  if (!sessions[key]) {
    sessions[key] = { step: 'idle', lang: 'ru', draft: emptyDraft() };
  }
  if (!sessions[key].draft) sessions[key].draft = emptyDraft();
  if (!sessions[key].lang) sessions[key].lang = 'ru';
  return sessions[key];
}

function persistSession(userId, session) {
  sessions[String(userId)] = session;
  saveSessions(sessions);
}

function resetFlow(session) {
  session.step = 'idle';
  session.draft = emptyDraft();
}

function zoneLabel(id) {
  return ZONES[id]?.label ?? id;
}

function normalizeChoice(text) {
  return String(text ?? '').trim().toLowerCase();
}

function operatorWhatsAppIds() {
  const raw = process.env.OPERATOR_WHATSAPP_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes('@') ? s : `${s.replace(/\D/g, '')}@c.us`))
    .filter((s) => s !== '@c.us');
}

function isWhatsAppOperator(userId) {
  const ids = operatorWhatsAppIds();
  return ids.some((id) => String(id) === String(userId));
}

function formatPrice(n) {
  return new Intl.NumberFormat('ru-RU').format(n);
}

function mainMenu() {
  return [
    'CEZAR PS5',
    '',
    'Чтобы начать новую бронь, отправьте 1.',
    '',
    'Выберите действие:',
    '1. Забронировать',
    '2. Мои брони',
    '3. Прайс',
    '4. Регистрация',
    '5. Промокод',
    '',
    'Команды: menu, lang, cancel',
  ].join('\n');
}

function nextBookingHint() {
  return 'Чтобы сделать новую бронь, отправьте 1 или menu.';
}

function langMenu() {
  return ['Выберите язык / Тілді таңдаңыз:', '1. Русский', '2. Қазақша'].join('\n');
}

function zoneMenu() {
  return ['Выберите зону:', '1. ЗАЛ', '2. КАБИНКА', '3. ВИП'].join('\n');
}

function timeMenu() {
  return [
    'Выберите время:',
    QUICK_HOURS.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    '',
    'Или отправьте время вручную, например 15:45',
  ].join('\n');
}

function durationMenu() {
  return ['Выберите длительность:', '1. 1 час', '2. 3 часа', '3. 5 часов'].join('\n');
}

function comboMenu(zone, durationMin) {
  const without = getPrice(zone, durationMin, false);
  const withCombo = getPrice(zone, durationMin, true);
  return [
    'Добавить комбо?',
    `1. Да - ${formatPrice(withCombo)} тг`,
    `2. Нет - ${formatPrice(without)} тг`,
  ].join('\n');
}

function buildPriceText() {
  return [
    'Прайс CEZAR PS5',
    '',
    'ЗАЛ',
    `1 час - ${formatPrice(BASE_PRICES.zal[60])} тг`,
    `3 часа - ${formatPrice(BASE_PRICES.zal[180])} тг`,
    `5 часов - ${formatPrice(BASE_PRICES.zal[300])} тг`,
    '',
    'КАБИНКА',
    `1 час - ${formatPrice(BASE_PRICES.cabinet[60])} тг`,
    `3 часа - ${formatPrice(BASE_PRICES.cabinet[180])} тг`,
    `5 часов - ${formatPrice(BASE_PRICES.cabinet[300])} тг`,
    '',
    'ВИП',
    `1 час - ${formatPrice(BASE_PRICES.vip[60])} тг`,
    `3 часа - ${formatPrice(BASE_PRICES.vip[180])} тг`,
    `5 часов - ${formatPrice(BASE_PRICES.vip[300])} тг`,
    '',
    'Комбо доступно на 3 и 5 часов.',
  ].join('\n');
}

function buildSummaryText(draft) {
  const combo = draft.durationMin === 60 ? 'нет' : draft.withCombo ? 'да' : 'нет';
  const total = getPrice(draft.zone, draft.durationMin, draft.withCombo === true);
  return [
    'Проверьте бронь:',
    '',
    `Зона: ${zoneLabel(draft.zone)}`,
    `Время: ${formatKzDateTime(draft.startIso)}`,
    `Длительность: ${minutesLabel(draft.durationMin, 'ru')}`,
    `Комбо: ${combo}`,
    `Сумма: ${formatPrice(total)} тг`,
  ].join('\n');
}

function userName(contact, message) {
  return contact?.pushname || contact?.name || message?._data?.notifyName || 'WhatsApp клиент';
}

function phoneFromContact(contact, userId) {
  const id = contact?.id?._serialized || String(userId);
  const server = contact?.id?.server || id.split('@')[1] || '';
  if (server === 'lid' || String(id).endsWith('@lid') || String(userId).endsWith('@lid')) {
    return '';
  }
  const raw = contact?.number || contact?.id?.user || (String(userId).endsWith('@c.us') ? String(userId).split('@')[0] : '');
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits || '';
}

function normalizeManualPhone(text) {
  let digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('7')) digits = `7${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : '';
}

function whatsappChatIdFromPhone(phone) {
  const digits = normalizeManualPhone(phone);
  return digits ? `${digits}@c.us` : '';
}

function whatsappPhoneDigitsForBooking(db, booking) {
  const userId = String(booking?.user_id ?? '');
  if (!userId.startsWith('admin:')) return '';
  const user = getUser(db, userId);
  const phone = user?.phone || userId.slice('admin:'.length);
  return normalizeManualPhone(phone);
}

async function whatsappRecipientForBooking(client, db, booking) {
  const userId = String(booking?.user_id ?? '');
  if (userId.includes('@')) return userId;
  const digits = whatsappPhoneDigitsForBooking(db, booking);
  if (!digits) return '';
  try {
    const numberId = await client.getNumberId(digits);
    if (numberId?._serialized) return numberId._serialized;
    console.warn(`[CEZAR WhatsApp] Could not find WhatsApp account for manual booking phone ${digits}.`);
    return '';
  } catch (e) {
    console.error(`[CEZAR WhatsApp] Could not resolve WhatsApp number ${digits}:`, e?.message ?? e);
    return '';
  }
}

function hasUsablePhone(userId, user, contactPhone) {
  if (contactPhone) return true;
  if (!user?.phone) return false;
  if (user.phone_source === 'manual') return true;
  return !String(userId).endsWith('@lid');
}

function parseZone(text) {
  const c = normalizeChoice(text);
  if (['1', 'зал', 'zal'].includes(c)) return 'zal';
  if (['2', 'кабинка', 'kabinka', 'cabinet'].includes(c)) return 'cabinet';
  if (['3', 'вип', 'vip'].includes(c)) return 'vip';
  return null;
}

function parseDuration(text) {
  const c = normalizeChoice(text);
  if (['1', '60', '1 час', '1ч'].includes(c)) return 60;
  if (['2', '180', '3 часа', '3ч'].includes(c)) return 180;
  if (['3', '300', '5 часов', '5ч'].includes(c)) return 300;
  return null;
}

function parseQuickTime(text) {
  const c = normalizeChoice(text);
  const idx = Number(c);
  if (Number.isInteger(idx) && idx >= 1 && idx <= QUICK_HOURS.length) return QUICK_HOURS[idx - 1];
  if (isValidTimeFormat(c)) return c;
  return null;
}

async function sendOperatorMessage(client, text) {
  const ids = operatorWhatsAppIds();
  if (!ids.length) return;
  for (const id of ids) {
    try {
      await client.sendMessage(id, text);
    } catch (e) {
      console.error(`[CEZAR WhatsApp] Operator message failed for ${id}:`, e?.message ?? e);
    }
  }
}

async function notifyOperatorsNewBooking(client, { booking, guestRow, guestName }) {
  const combo = booking.with_combo ? 'да' : 'нет';
  const promo = booking.promo_code ? `\nПромокод: ${booking.promo_code}` : '';
  const text = [
    'Новая бронь',
    '',
    `№ ${booking.id}`,
    `Зона: ${zoneLabel(booking.zone)}`,
    `Начало: ${formatKzDateTime(booking.start_datetime)}`,
    `Длительность: ${minutesLabel(booking.duration_minutes, 'ru')}`,
    `Комбо: ${combo}${promo}`,
    `Сумма: ${formatPrice(booking.total_price)} тг`,
    '',
    `Клиент: ${guestName}`,
    `Телефон: ${guestRow?.phone || '—'}`,
    `WhatsApp ID: ${booking.user_id}`,
  ].join('\n');
  await sendOperatorMessage(client, text);
}

function manualConfirmationText(booking) {
  return [
    'Здравствуйте! Ваша бронь в CEZAR PS5 подтверждена.',
    '',
    `Зона: ${zoneLabel(booking.zone)}`,
    `Начало: ${formatKzDateTime(booking.start_datetime)}`,
    'Ждем вас!',
  ].join('\n');
}

function startManualWhatsAppConfirmationJob(client, db) {
  const tick = async () => {
    refreshDb(db);
    const now = Date.now();
    const list = db.bookings.filter((b) => {
      if (!String(b.user_id ?? '').startsWith('admin:')) return false;
      if (!isBookedStatus(b.status)) return false;
      if (b.manual_whatsapp_confirmation_sent === 1) return false;
      if (b.manual_whatsapp_confirmation_error) return false;
      return new Date(b.start_datetime).getTime() > now;
    });

    for (const b of list) {
      const recipient = await whatsappRecipientForBooking(client, db, b);
      if (!recipient) {
        markManualWhatsAppConfirmationFailed(db, b.id, 'whatsapp_account_not_found');
        continue;
      }
      try {
        await client.sendMessage(recipient, manualConfirmationText(b));
        markManualWhatsAppConfirmationSent(db, b.id);
      } catch (e) {
        console.error(`[CEZAR WhatsApp] Manual booking confirmation failed for booking ${b.id}:`, e?.message ?? e);
      }
    }
  };
  void tick();
  return setInterval(() => void tick(), 30_000);
}

function startWhatsAppReminderJob(client, db) {
  const tick = async () => {
    const { getBookingsNeedingReminder, markReminderSent } = await import('./db.js');
    for (const b of getBookingsNeedingReminder(db)) {
      const recipient = await whatsappRecipientForBooking(client, db, b);
      if (!recipient) continue;
      try {
        await client.sendMessage(
          recipient,
          `Напоминание: ваша бронь ${zoneLabel(b.zone)} начнется ${formatKzDateTime(
            b.start_datetime,
          )}. Длительность: ${minutesLabel(b.duration_minutes, 'ru')}.`,
        );
        markReminderSent(db, b.id);
      } catch {}
    }
  };
  void tick();
  return setInterval(() => void tick(), 60_000);
}

function startWhatsAppReview2gisJob(client, db) {
  const tick = async () => {
    const url = process.env.TWO_GIS_REVIEW_URL?.trim();
    if (!url) return;
    const { getBookingsNeedingReview2gis, markReview2gisSent } = await import('./db.js');
    for (const b of getBookingsNeedingReview2gis(db)) {
      const recipient = await whatsappRecipientForBooking(client, db, b);
      if (!recipient) continue;
      try {
        await client.sendMessage(
          recipient,
          `Спасибо за визит в CEZAR! Будем рады вашей оценке в 2GIS:\n${url}`,
        );
        markReview2gisSent(db, b.id);
      } catch {}
    }
  };
  void tick();
  return setInterval(() => void tick(), 180_000);
}

async function handleOperatorCommand(client, db, userId, body) {
  if (!isWhatsAppOperator(userId)) return false;
  const cmd = normalizeChoice(body).split(/\s+/)[0];
  if (cmd === '/operator') {
    await client.sendMessage(
      userId,
      [
        'Команды оператора:',
        '/today - брони на сегодня',
        '/stats - статистика',
        '/promo_list - активные промокоды',
        '/resetbookings - удалить все брони',
        '/exportclients - краткая сводка клиентов',
        '/exportbookings - краткая сводка броней',
        '/registrations - незавершенные регистрации',
      ].join('\n'),
    );
    return true;
  }
  if (cmd === '/today' || cmd === '/bugun') {
    const { start, end } = getLocalDayRangeIso();
    const rows = listConfirmedBookingsInRange(db, start, end);
    if (!rows.length) {
      await client.sendMessage(userId, 'На сегодня броней нет.');
      return true;
    }
    const lines = rows.map((r) => {
      const u = getUser(db, r.user_id);
      return `#${r.id} ${zoneLabel(r.zone)} ${formatKzDateTime(r.start_datetime)} ${minutesLabel(
        r.duration_minutes,
        'ru',
      )}, ${r.total_price} тг, ${u?.phone || '—'}`;
    });
    await client.sendMessage(userId, `Брони на сегодня:\n\n${lines.join('\n')}`);
    return true;
  }
  if (cmd === '/stats') {
    const periods = [
      ['Сегодня', getLocalDayRangeIso()],
      ['Неделя', getWeekRangeIso()],
      ['Месяц', getMonthRangeIso()],
    ];
    const lines = ['Статистика'];
    for (const [label, range] of periods) {
      const s = getStatsForPeriod(db, range.start, range.end);
      lines.push(
        '',
        label,
        `Броней: ${s.totalBookings}`,
        `Клиентов: ${s.uniqueClients}`,
        `Зал: ${s.byZone.zal}, Кабинка: ${s.byZone.cabinet}, ВИП: ${s.byZone.vip}`,
      );
    }
    await client.sendMessage(userId, lines.join('\n'));
    return true;
  }
  if (cmd === '/promo_list') {
    const list = listActivePromoCodes(db, 50);
    await client.sendMessage(
      userId,
      list.length ? `Активные промокоды:\n${list.map((p) => `- ${p.code}`).join('\n')}` : 'Активных промокодов нет.',
    );
    return true;
  }
  if (cmd === '/resetbookings') {
    resetBookings(db);
    await client.sendMessage(userId, 'Все брони удалены.');
    return true;
  }
  if (cmd === '/exportclients') {
    const clients = getAllClientsForExport(db);
    await client.sendMessage(userId, `Клиентов: ${clients.length}`);
    return true;
  }
  if (cmd === '/exportbookings') {
    const bookings = getAllBookingsForExport(db);
    await client.sendMessage(userId, `Всего броней: ${bookings.length}`);
    return true;
  }
  if (cmd === '/registrations') {
    const rows = getIncompleteRegistrations(db);
    await client.sendMessage(userId, rows.length ? `Незавершенных регистраций: ${rows.length}` : 'Все регистрации завершены.');
    return true;
  }
  return false;
}

async function handleMessage(client, db, message) {
  if (message.fromMe || message.from === 'status@broadcast') return;

  const userId = message.from;
  const body = String(message.body ?? '').trim();
  if (!body) return;

  if (await handleOperatorCommand(client, db, userId, body)) return;

  const contact = await message.getContact().catch(() => null);
  const name = userName(contact, message);
  const session = getSession(userId);
  const savedUser = getUser(db, userId);
  if (savedUser?.lang && !session.lang) session.lang = savedUser.lang;

  const lower = normalizeChoice(body);
  if (['start', '/start', 'menu', 'меню'].includes(lower)) {
    resetFlow(session);
    persistSession(userId, session);
    await client.sendMessage(userId, mainMenu());
    return;
  }
  if (['cancel', 'отмена', 'назад'].includes(lower)) {
    resetFlow(session);
    persistSession(userId, session);
    await client.sendMessage(userId, `Отменено.\n\n${mainMenu()}`);
    return;
  }
  if (['lang', '/lang', 'язык', 'тіл'].includes(lower)) {
    session.step = 'lang';
    persistSession(userId, session);
    await client.sendMessage(userId, langMenu());
    return;
  }

  if (session.step === 'lang') {
    const lang = lower === '2' || lower.includes('қ') || lower.includes('каз') ? 'kz' : 'ru';
    session.lang = lang;
    upsertUserLang(db, userId, lang);
    resetFlow(session);
    persistSession(userId, session);
    await client.sendMessage(userId, `${lang === 'kz' ? 'Тіл сақталды.' : 'Язык сохранен.'}\n\n${mainMenu()}`);
    return;
  }

  if (session.step === 'idle') {
    if (lower === '1' || lower.includes('брон')) {
      session.draft = emptyDraft();
      session.step = 'zone';
      persistSession(userId, session);
      await client.sendMessage(userId, zoneMenu());
      return;
    }
    if (lower === '2' || lower.includes('мои')) {
      const rows = listUpcomingBookings(db, userId);
      if (!rows.length) {
        await client.sendMessage(userId, `У вас нет будущих броней.\n\n${mainMenu()}`);
        return;
      }
      const lines = rows.map(
        (r) =>
          `#${r.id} ${zoneLabel(r.zone)} ${formatKzDateTime(r.start_datetime)} ${minutesLabel(
            r.duration_minutes,
            'ru',
          )}, ${formatPrice(r.total_price)} тг`,
      );
      const last = getLastBooking(db, userId);
      const repeat = last ? '\n\nЧтобы повторить последнюю бронь, отправьте repeat. Чтобы отменить бронь: cancel #номер' : '';
      await client.sendMessage(userId, `Ваши брони:\n\n${lines.join('\n')}${repeat}`);
      return;
    }
    if (lower === '3' || lower.includes('прайс') || lower.includes('баға')) {
      await client.sendMessage(userId, `${buildPriceText()}\n\n${mainMenu()}`);
      return;
    }
    if (lower === '4' || lower.includes('рег')) {
      saveRegistrationAttempt(db, userId, name);
      const phone = phoneFromContact(contact, userId);
      if (!hasUsablePhone(userId, savedUser, phone)) {
        session.step = 'phone_registration';
        persistSession(userId, session);
        await client.sendMessage(userId, 'Напишите ваш номер телефона, например 77771234567.');
        return;
      }
      upsertUserPhone(db, userId, name, phone, { phoneSource: phone ? 'whatsapp' : undefined });
      completeRegistration(db, userId);
      const savedPhone = phone || getUser(db, userId)?.phone || '';
      await client.sendMessage(userId, `Регистрация завершена. Телефон: ${savedPhone || 'не определен'}\n\n${mainMenu()}`);
      return;
    }
    if (lower === '5' || lower.includes('промо')) {
      session.step = 'promo';
      persistSession(userId, session);
      await client.sendMessage(userId, 'Отправьте промокод.');
      return;
    }
    if (lower === 'repeat') {
      const last = getLastBooking(db, userId);
      if (!last) {
        await client.sendMessage(userId, 'Последняя бронь не найдена.');
        return;
      }
      session.draft = {
        zone: last.zone,
        startIso: null,
        durationMin: last.duration_minutes,
        withCombo: last.with_combo === 1,
        repeatMode: true,
      };
      session.step = 'time';
      persistSession(userId, session);
      await client.sendMessage(userId, `Повторяем: ${zoneLabel(last.zone)}, ${minutesLabel(last.duration_minutes, 'ru')}.\n\n${timeMenu()}`);
      return;
    }
    if (lower.startsWith('cancel #')) {
      const id = Number(lower.replace('cancel #', '').trim());
      const r = cancelBooking(db, id, userId);
      await client.sendMessage(userId, r.ok ? 'Бронь отменена.' : 'Не удалось отменить бронь.');
      return;
    }
    await client.sendMessage(userId, mainMenu());
    return;
  }

  if (session.step === 'phone_registration' || session.step === 'phone_before_confirm') {
    const phone = normalizeManualPhone(body);
    if (!phone) {
      await client.sendMessage(userId, 'Не получилось распознать номер. Напишите номер в формате 77771234567.');
      return;
    }
    upsertUserPhone(db, userId, name, phone, { phoneSource: 'manual' });
    completeRegistration(db, userId);
    if (session.step === 'phone_registration') {
      resetFlow(session);
      persistSession(userId, session);
      await client.sendMessage(userId, `Регистрация завершена. Телефон: ${phone}\n\n${mainMenu()}`);
      return;
    }
    session.step = 'confirm';
    persistSession(userId, session);
    await client.sendMessage(userId, `Телефон сохранен: ${phone}\n\n${buildSummaryText(session.draft)}\n\nПодтвердить? 1. Да  2. Нет`);
    return;
  }

  if (session.step === 'zone') {
    const zone = parseZone(body);
    if (!zone) {
      await client.sendMessage(userId, zoneMenu());
      return;
    }
    session.draft.zone = zone;
    session.step = 'time';
    persistSession(userId, session);
    await client.sendMessage(userId, timeMenu());
    return;
  }

  if (session.step === 'time') {
    const time = parseQuickTime(body);
    if (!time) {
      await client.sendMessage(userId, timeMenu());
      return;
    }
    const r = resolveBookingDateTime(time, session.lang || 'ru');
    if (!r.ok) {
      await client.sendMessage(userId, `Ошибка: ${r.error}`);
      return;
    }
    session.draft.startIso = r.iso;
    if (session.draft.repeatMode) {
      const v = validateBookingFitsClosing(r.iso, session.draft.durationMin, session.lang || 'ru');
      if (!v.ok) {
        await client.sendMessage(userId, `Ошибка: ${v.error}`);
        return;
      }
      session.step = 'confirm';
      persistSession(userId, session);
      await client.sendMessage(userId, `${buildSummaryText(session.draft)}\n\nПодтвердить? 1. Да  2. Нет`);
      return;
    }
    session.step = 'duration';
    persistSession(userId, session);
    await client.sendMessage(userId, durationMenu());
    return;
  }

  if (session.step === 'duration') {
    const duration = parseDuration(body);
    if (!duration) {
      await client.sendMessage(userId, durationMenu());
      return;
    }
    const v = validateBookingFitsClosing(session.draft.startIso, duration, session.lang || 'ru');
    if (!v.ok) {
      session.step = 'time';
      persistSession(userId, session);
      await client.sendMessage(userId, `Ошибка: ${v.error}\n\n${timeMenu()}`);
      return;
    }
    session.draft.durationMin = duration;
    if (duration === 60) {
      session.draft.withCombo = false;
      session.step = 'confirm';
      persistSession(userId, session);
      await client.sendMessage(userId, `${buildSummaryText(session.draft)}\n\nПодтвердить? 1. Да  2. Нет`);
      return;
    }
    session.step = 'combo';
    persistSession(userId, session);
    await client.sendMessage(userId, comboMenu(session.draft.zone, duration));
    return;
  }

  if (session.step === 'combo') {
    if (!['1', '2', 'да', 'нет'].includes(lower)) {
      await client.sendMessage(userId, comboMenu(session.draft.zone, session.draft.durationMin));
      return;
    }
    session.draft.withCombo = lower === '1' || lower === 'да';
    session.step = 'confirm';
    persistSession(userId, session);
    await client.sendMessage(userId, `${buildSummaryText(session.draft)}\n\nПодтвердить? 1. Да  2. Нет`);
    return;
  }

  if (session.step === 'promo') {
    const code = body.toUpperCase().replace(/\s+/g, '');
    const v = validatePromoCode(db, code);
    if (!v.ok) {
      resetFlow(session);
      persistSession(userId, session);
      await client.sendMessage(userId, `Промокод не найден или уже использован.\n\n${mainMenu()}`);
      return;
    }
    setUserPromoPending(db, userId, v.code);
    resetFlow(session);
    persistSession(userId, session);
    await client.sendMessage(userId, `Промокод сохранен: ${v.code}\nОн применится к следующей брони.\n\n${mainMenu()}`);
    return;
  }

  if (session.step === 'confirm') {
    if (!['1', 'да', 'yes', '+'].includes(lower)) {
      resetFlow(session);
      persistSession(userId, session);
      await client.sendMessage(userId, `Бронь не создана.\n\n${mainMenu()}`);
      return;
    }
    const d = session.draft;
    const startMs = new Date(d.startIso).getTime();
    const endMs = startMs + d.durationMin * 60 * 1000;
    const cap = ZONE_CAPACITY[d.zone] ?? 1;
    const { count, earliestEndMs } = analyzeOverlapForSlot(db, d.zone, startMs, endMs);
    if (count >= cap) {
      const hint = earliestEndMs ? `\nБлижайшее освобождение: ${formatKzDateTime(new Date(earliestEndMs).toISOString())}` : '';
      session.step = 'time';
      persistSession(userId, session);
      await client.sendMessage(userId, `На это время мест нет.${hint}\n\n${timeMenu()}`);
      return;
    }
    const contactPhone = phoneFromContact(contact, userId);
    const currentUser = getUser(db, userId);
    if (!hasUsablePhone(userId, currentUser, contactPhone)) {
      session.step = 'phone_before_confirm';
      persistSession(userId, session);
      await client.sendMessage(userId, 'Перед подтверждением напишите ваш номер телефона, например 77771234567.');
      return;
    }
    upsertUserPhone(db, userId, name, contactPhone, { phoneSource: contactPhone ? 'whatsapp' : undefined });
    const user = getUser(db, userId);
    let promoToApply = null;
    if (user?.promo_pending) {
      const v = validatePromoCode(db, user.promo_pending);
      if (v.ok) promoToApply = v.code;
      else clearUserPromoPending(db, userId);
    }
    const total = getPrice(d.zone, d.durationMin, d.withCombo === true);
    const booking = insertBooking(db, {
      userId,
      zone: d.zone,
      startDatetimeIso: d.startIso,
      durationMinutes: d.durationMin,
      withCombo: d.withCombo === true,
      totalPrice: total,
      promoCode: promoToApply,
    });
    if (promoToApply) {
      const used = markPromoUsed(db, promoToApply, userId);
      clearUserPromoPending(db, userId);
      if (!used.ok) promoToApply = null;
    }
    resetFlow(session);
    persistSession(userId, session);
    await client.sendMessage(
      userId,
      `Бронь подтверждена!${promoToApply ? `\nПромокод применен: ${promoToApply}` : ''}\n\n${buildSummaryText(d)}\n\n${nextBookingHint()}\n\n${mainMenu()}`,
    );
    await notifyOperatorsNewBooking(client, { booking, guestRow: getUser(db, userId), guestName: name });
  }
}

loadEnvFile();
const dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'store.json');
process.env.DB_PATH = dbPath;
const db = openDb();
const pairingPhone = String(process.env.WHATSAPP_PAIRING_PHONE ?? '').replace(/\D/g, '');
const pairingEnabled = pairingPhone.length > 0;
const webVersionUrl = process.env.WHATSAPP_WEB_VERSION_URL?.trim() || DEFAULT_WA_WEB_VERSION_URL;
const processedMessageIds = new Map();
const processedMessageTtlMs = 5 * 60 * 1000;
let backgroundJobsStarted = false;

function shouldHandleIncomingMessage(message) {
  const id = message?.id?._serialized || message?.id?.id || '';
  if (!id) return true;
  const now = Date.now();
  if (processedMessageIds.has(id)) return false;
  processedMessageIds.set(id, now);
  if (processedMessageIds.size > 500) {
    for (const [key, ts] of processedMessageIds) {
      if (now - ts > processedMessageTtlMs) processedMessageIds.delete(key);
    }
  }
  return true;
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: process.env.WHATSAPP_CLIENT_ID || 'cezarbot' }),
  webVersionCache: {
    type: 'remote',
    remotePath: webVersionUrl,
  },
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
    ],
  },
  ...(pairingEnabled
    ? {
        pairWithPhoneNumber: {
          phoneNumber: pairingPhone,
          showNotification: true,
          intervalMs: 180_000,
        },
      }
    : {}),
});

if (pairingEnabled) {
  console.log(`[CEZAR WhatsApp] Pairing by phone is enabled for ${pairingPhone}.`);
  console.log('[CEZAR WhatsApp] Open WhatsApp -> Settings -> Linked devices -> Link with phone number.');
}

client.on('qr', (qr) => {
  console.log('[CEZAR WhatsApp] Scan this QR code in WhatsApp:');
  qrcode.generate(qr, { small: true });
  QRCode.toFile(QR_IMAGE_FILE, qr, { width: 900, margin: 3 })
    .then(() => {
      console.log(`[CEZAR WhatsApp] QR image saved: ${QR_IMAGE_FILE}`);
      console.log('[CEZAR WhatsApp] Open this image if the terminal QR does not fit on screen.');
    })
    .catch((e) => {
      console.error('[CEZAR WhatsApp] Could not save QR image:', e?.message ?? e);
    });
});

client.on('code', (code) => {
  console.log('');
  console.log(`[CEZAR WhatsApp] Pairing code: ${code}`);
  console.log('[CEZAR WhatsApp] Enter it in WhatsApp -> Settings -> Linked devices -> Link with phone number.');
  console.log('');
});

client.on('ready', () => {
  console.log('[CEZAR WhatsApp] Bot is ready.');
  if (backgroundJobsStarted) return;
  backgroundJobsStarted = true;
  startManualWhatsAppConfirmationJob(client, db);
  startWhatsAppReminderJob(client, db);
  startWhatsAppReview2gisJob(client, db);
});

client.on('message', (message) => {
  if (!shouldHandleIncomingMessage(message)) return;
  handleMessage(client, db, message).catch((e) => {
    console.error('[CEZAR WhatsApp] Handler error:', e);
  });
});

client.on('disconnected', (reason) => {
  console.error('[CEZAR WhatsApp] Disconnected:', reason);
});

console.log('[CEZAR WhatsApp] Starting...');
console.log(`[CEZAR WhatsApp] Web version cache: ${webVersionUrl}`);
try {
  await client.initialize();
} catch (e) {
  console.error('[CEZAR WhatsApp] Failed to start:', e?.message ?? e);
  console.error('[CEZAR WhatsApp] If this repeats, close WhatsApp Desktop/Chrome, rename .wwebjs_auth/session-cezarbot, then run npm run start:whatsapp and scan the new QR.');
  throw e;
}
