import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { CLOSE_TIME, OPEN_TIME } from '../config.js';
import { t, DEFAULT_LANG } from '../i18n.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TZ || 'Asia/Almaty';

/**
 * HH:mm формат (24 часа), например 09:05, 15:45
 */
export function isValidTimeFormat(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return false;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return false;
  return true;
}

export function parseTimeParts(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2]) };
}

function timeToMinutes(hhmm) {
  const p = parseTimeParts(hhmm);
  if (!p) return null;
  return p.h * 60 + p.min;
}

function isStartMinuteInBusinessWindow(startM, openM, closeM) {
  if (openM == null || closeM == null) return true;
  if (openM <= closeM) return startM >= openM && startM < closeM;
  return startM >= openM || startM < closeM;
}

/**
 * Выбор сегодняшнего или завтрашнего дня: если время уже прошло — завтра.
 * @param {string} timeStr  — "HH:mm"
 * @param {string} [lang]   — язык для сообщений об ошибках
 */
export function resolveBookingDateTime(timeStr, lang = DEFAULT_LANG, now = new Date()) {
  const p = parseTimeParts(timeStr);
  if (!p) return { ok: false, error: t(lang, 'time_format_err') };

  const nowTz = dayjs(now).tz(TZ);
  let candidate = nowTz
    .clone()
    .startOf('day')
    .hour(p.h)
    .minute(p.min)
    .second(0)
    .millisecond(0);
  if (candidate.isBefore(nowTz)) {
    candidate = candidate.add(1, 'day');
  }

  const openM = timeToMinutes(OPEN_TIME);
  const closeM = timeToMinutes(CLOSE_TIME);
  const startM = p.h * 60 + p.min;
  if (
    openM != null &&
    closeM != null &&
    !isStartMinuteInBusinessWindow(startM, openM, closeM)
  ) {
    return {
      ok: false,
      error: t(lang, 'time_range_err', OPEN_TIME, CLOSE_TIME),
    };
  }

  return { ok: true, date: candidate.toDate(), iso: candidate.toISOString() };
}

export function addMinutesToIso(iso, minutes) {
  return dayjs(iso).add(minutes, 'minute').toISOString();
}

export function formatKzDateTime(iso) {
  return dayjs(iso).tz(TZ).format('DD.MM.YYYY HH:mm');
}

/**
 * Метка длительности на нужном языке.
 */
export function minutesLabel(min, lang = DEFAULT_LANG) {
  if (min === 60) return t(lang, 'min_1h');
  if (min === 180) return t(lang, 'min_3h');
  if (min === 300) return t(lang, 'min_5h');
  return `${min} мин`;
}

function getClosingBoundaryForStart(startTz) {
  const closeP = parseTimeParts(CLOSE_TIME);
  if (!closeP) return null;
  const openM = timeToMinutes(OPEN_TIME);
  const closeM = timeToMinutes(CLOSE_TIME);
  const startM = startTz.hour() * 60 + startTz.minute();
  const dayStart = startTz.startOf('day');

  if (openM != null && closeM != null && openM > closeM) {
    if (startM >= openM) {
      return dayStart
        .add(1, 'day')
        .hour(closeP.h)
        .minute(closeP.min)
        .second(0)
        .millisecond(0);
    }
    return dayStart.hour(closeP.h).minute(closeP.min).second(0).millisecond(0);
  }
  return dayStart.hour(closeP.h).minute(closeP.min).second(0).millisecond(0);
}

/**
 * Начало + длительность не должны выходить за рамки закрытия (например 03:00).
 * @param {string} [lang] — язык для сообщений об ошибках
 */
export function validateBookingFitsClosing(startIso, durationMinutes, lang = DEFAULT_LANG) {
  const startTz = dayjs(startIso).tz(TZ);
  const closeTz = getClosingBoundaryForStart(startTz);
  if (!closeTz) return { ok: true };
  const endTz = startTz.add(durationMinutes, 'minute');
  if (endTz.isAfter(closeTz)) {
    const lastStart = closeTz.subtract(durationMinutes, 'minute');
    return {
      ok: false,
      error: t(
        lang,
        'closing_err',
        minutesLabel(durationMinutes, lang),
        CLOSE_TIME,
        lastStart.format('DD.MM.YYYY HH:mm'),
      ),
    };
  }
  return { ok: true };
}

/** Границы текущего дня в локальном часовом поясе (ISO) */
export function getLocalDayRangeIso(now = new Date()) {
  const start = dayjs(now).tz(TZ).startOf('day').toISOString();
  const end = dayjs(now).tz(TZ).endOf('day').toISOString();
  return { start, end };
}

/** С начала текущей недели (пн) по конец сегодняшнего дня */
export function getWeekRangeIso(now = new Date()) {
  const d = dayjs(now).tz(TZ);
  const dayOfWeek = d.day(); // 0=вс, 1=пн, ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = d.subtract(daysToMonday, 'day').startOf('day').toISOString();
  const end = d.endOf('day').toISOString();
  return { start, end };
}

/** С 1-го числа текущего месяца по конец сегодняшнего дня */
export function getMonthRangeIso(now = new Date()) {
  const d = dayjs(now).tz(TZ);
  const start = d.startOf('month').toISOString();
  const end = d.endOf('day').toISOString();
  return { start, end };
}
