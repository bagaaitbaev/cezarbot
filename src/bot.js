import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Telegraf, session, Markup } from 'telegraf';
import { makeSessionStore } from './utils/sessionStore.js';
import { BASE_PRICES, QUICK_HOURS, ZONE_CAPACITY, ZONES } from './config.js';
import { t, DEFAULT_LANG } from './i18n.js';

const __botDir = path.dirname(fileURLToPath(import.meta.url));
const __projectRoot = path.join(__botDir, '..');
import {
  analyzeOverlapForSlot,
  getAllBookingsForExport,
  getAllClientsForExport,
  getLastBooking,
  getStatsForPeriod,
  getUser,
  insertBooking,
  listConfirmedBookingsInRange,
  listUpcomingBookings,
  resetBookings,
  upsertUserLang,
  upsertUserPhone,
} from './db.js';
import { isOperator, isOperatorCtx, notifyOperatorsNewBooking } from './operators.js';
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

/** Фото: .env → WELCOME_IMAGE= или assets/welcome.jpg (jpeg/png/webp) */
function resolveWelcomeImagePath() {
  const envPath = process.env.WELCOME_IMAGE?.trim();
  const candidates = [];
  if (envPath) {
    candidates.push(
      path.isAbsolute(envPath) ? envPath : path.join(__projectRoot, envPath),
    );
  }
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    candidates.push(path.join(__projectRoot, 'assets', `welcome.${ext}`));
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const DEFAULT_WELCOME_IMAGE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/PlayStation_5_and_DualSense.jpg/960px-PlayStation_5_and_DualSense.jpg';

function zoneLabel(id) {
  return ZONES[id]?.label ?? id;
}

function getLang(ctx) {
  return ctx.session?.lang || DEFAULT_LANG;
}

function encodeQuick(time) {
  const [h, m] = time.split(':').map(Number);
  return `tq:${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function decodeQuick(payload) {
  const m = payload.match(/^tq:(\d{4})$/);
  if (!m) return null;
  const s = m[1];
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

function emptyDraft() {
  return {
    zone: null,
    startIso: null,
    durationMin: null,
    withCombo: null,
    repeatMode: false,
  };
}

function buildSummaryText(draft, lang) {
  const z = zoneLabel(draft.zone);
  const time = formatKzDateTime(draft.startIso);
  const dur = minutesLabel(draft.durationMin, lang);
  const combo =
    draft.durationMin === 60
      ? t(lang, 'combo_none_1h')
      : draft.withCombo
        ? t(lang, 'combo_with')
        : t(lang, 'combo_without');
  const total = getPrice(draft.zone, draft.durationMin, draft.withCombo === true);
  return t(lang, 'summary', z, time, dur, combo, total);
}

// ── Клавиатуры ─────────────────────────────────────────────────────────────

function langKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇰🇿 Қазақша', 'lang:kz'),
      Markup.button.callback('🇷🇺 Русский', 'lang:ru'),
    ],
  ]);
}

function mainKeyboard(lang) {
  return Markup.keyboard([
    [t(lang, 'btn_book'), t(lang, 'btn_my_bookings')],
    [t(lang, 'btn_price')],
  ]).resize();
}

function zoneKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('ЗАЛ', 'z:zal'),
      Markup.button.callback('КАБИНКА', 'z:cabinet'),
      Markup.button.callback('ВИП', 'z:vip'),
    ],
  ]);
}

function timeKeyboard(lang) {
  const rows = [];
  for (let i = 0; i < QUICK_HOURS.length; i += 3) {
    const chunk = QUICK_HOURS.slice(i, i + 3);
    rows.push(chunk.map((tm) => Markup.button.callback(tm, encodeQuick(tm))));
  }
  rows.push([Markup.button.callback(t(lang, 'btn_time_custom'), 'tc')]);
  return Markup.inlineKeyboard(rows);
}

function durationKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'btn_dur_1h'), 'd:60'),
      Markup.button.callback(t(lang, 'btn_dur_3h'), 'd:180'),
    ],
    [Markup.button.callback(t(lang, 'btn_dur_5h'), 'd:300')],
  ]);
}

function comboKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'btn_combo_yes'), 'cb:1'),
      Markup.button.callback(t(lang, 'btn_combo_no'), 'cb:0'),
    ],
  ]);
}

function confirmKeyboard(lang) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t(lang, 'btn_confirm'), 'cf'),
      Markup.button.callback(t(lang, 'btn_change'), 'ch'),
    ],
  ]);
}

function phoneKeyboard(lang) {
  return Markup.keyboard([[Markup.button.contactRequest(t(lang, 'btn_phone'))]])
    .oneTime()
    .resize();
}

// ── Вспомогательные ────────────────────────────────────────────────────────

async function proceedAfterTimeForRepeat(ctx) {
  const lang = getLang(ctx);
  const d = ctx.session.draft;
  d.repeatMode = false;
  if (d.durationMin === 60) {
    d.withCombo = false;
    ctx.session.step = 'phone';
    await ctx.reply(t(lang, 'phone_prompt'), phoneKeyboard(lang));
    return;
  }
  ctx.session.step = 'phone';
  if (d.withCombo) {
    await ctx.reply(
      t(lang, 'phone_repeat_with_combo', zoneLabel(d.zone), getPrice(d.zone, d.durationMin, true)),
      phoneKeyboard(lang),
    );
  } else {
    await ctx.reply(t(lang, 'phone_prompt'), phoneKeyboard(lang));
  }
}

// ── Создание бота ──────────────────────────────────────────────────────────

export function createBot(db) {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.use(
    session({
      defaultSession: () => ({ step: 'idle', draft: emptyDraft(), lang: null }),
      store: makeSessionStore(),
    }),
  );

  /** Загружаем сохранённый язык из БД, если в сессии ещё не установлен */
  bot.use(async (ctx, next) => {
    if (ctx.session && !ctx.session.lang && ctx.from?.id) {
      const user = getUser(db, ctx.from.id);
      if (user?.lang) ctx.session.lang = user.lang;
    }
    return next();
  });

  // ── Экран выбора языка ─────────────────────────────────────────────────

  async function showLangSelect(ctx) {
    ctx.session.step = 'idle';
    ctx.session.draft = emptyDraft();
    await ctx.reply(t(DEFAULT_LANG, 'lang_prompt'), langKeyboard());
  }

  async function sendWelcome(ctx) {
    const lang = getLang(ctx);
    ctx.session.step = 'idle';
    ctx.session.draft = emptyDraft();
    const imgPath = resolveWelcomeImagePath();
    const imgUrl = process.env.WELCOME_IMAGE_URL?.trim();
    const caption = t(lang, 'welcome');
    const photoOpts = { caption, ...mainKeyboard(lang) };
    try {
      if (imgPath) {
        await ctx.replyWithPhoto({ source: imgPath }, photoOpts);
        return;
      }
      const url = imgUrl || DEFAULT_WELCOME_IMAGE_URL;
      await ctx.replyWithPhoto(url, photoOpts);
    } catch (e) {
      console.error('[CEZAR] welcome photo failed:', e?.message ?? e);
      await ctx.reply(caption, mainKeyboard(lang));
    }
  }

  // /start — всегда показываем выбор языка
  bot.start(showLangSelect);

  // /lang — поменять язык
  bot.command('lang', showLangSelect);

  // /resetbookings — сброс всех броней (только для оператора)
  bot.command('resetbookings', async (ctx) => {
    if (!isOperatorCtx(ctx)) return;
    resetBookings(db);
    await ctx.reply('✅ Все брони удалены. База броней сброшена.');
  });

  // ── Операторские команды ───────────────────────────────────────────────

  bot.command('operator', async (ctx) => {
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) {
      await ctx.reply(t(lang, 'operator_only'));
      return;
    }
    await ctx.reply(t(lang, 'operator_help'));
  });

  bot.command(['bugun', 'today'], async (ctx) => {
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) {
      await ctx.reply(t(lang, 'operator_only_short'));
      return;
    }
    const { start, end } = getLocalDayRangeIso();
    const rows = listConfirmedBookingsInRange(db, start, end);
    const dayStr = formatKzDateTime(start).split(' ')[0];
    if (!rows.length) {
      await ctx.reply(t(lang, 'no_bookings_today', dayStr));
      return;
    }
    const lines = rows.map((r) => {
      const u = getUser(db, r.user_id);
      const combo = r.with_combo ? t(lang, 'combo_label') : t(lang, 'no_combo_label');
      const phone = u?.phone ?? '—';
      const nm = u?.telegram_name ?? '—';
      return (
        `#${r.id} • ${zoneLabel(r.zone)} • ${formatKzDateTime(r.start_datetime)} • ` +
        `${minutesLabel(r.duration_minutes, lang)} • ${combo} • ${r.total_price} ₸\n` +
        `   📞 ${phone} · ${nm}`
      );
    });
    await ctx.reply(`${t(lang, 'bookings_today', dayStr)}\n\n${lines.join('\n\n')}`);
  });

  bot.command('stats', async (ctx) => {
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) {
      await ctx.reply(t(lang, 'operator_only_short'));
      return;
    }
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(t(lang, 'stats_btn_today'), 'stats:today'),
        Markup.button.callback(t(lang, 'stats_btn_week'), 'stats:week'),
        Markup.button.callback(t(lang, 'stats_btn_month'), 'stats:month'),
      ],
    ]);
    await ctx.reply(t(lang, 'stats_period_choose'), keyboard);
  });

  // ── CSV-экспорт ────────────────────────────────────────────────────────

  function csvEscape(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function buildCsv(headers, rows) {
    const lines = [headers.map(csvEscape).join(',')];
    for (const row of rows) lines.push(row.map(csvEscape).join(','));
    return '\uFEFF' + lines.join('\r\n');
  }

  bot.command('exportclients', async (ctx) => {
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) {
      await ctx.reply(t(lang, 'operator_only_short'));
      return;
    }
    const clients = getAllClientsForExport(db);
    if (!clients.length) {
      await ctx.reply('📋 Нет данных о клиентах.');
      return;
    }
    const headers = ['Имя', 'Телефон', 'Кол-во броней', 'Последняя бронь', 'Потрачено (тг)'];
    const rows = clients.map((c) => [
      c.name,
      c.phone,
      c.bookingCount,
      c.lastBooking ? formatKzDateTime(c.lastBooking).split(' ')[0] : '—',
      c.totalSpent,
    ]);
    const csv = buildCsv(headers, rows);
    await ctx.replyWithDocument(
      { source: Buffer.from(csv, 'utf8'), filename: 'clients.csv' },
      { caption: `👥 Уникальных клиентов: ${clients.length}` },
    );
  });

  bot.command('exportbookings', async (ctx) => {
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) {
      await ctx.reply(t(lang, 'operator_only_short'));
      return;
    }
    const bookings = getAllBookingsForExport(db);
    if (!bookings.length) {
      await ctx.reply('📋 Нет данных о бронях.');
      return;
    }
    const headers = ['№', 'Дата и время', 'Клиент', 'Телефон', 'Зона', 'Длит. (мин)', 'Комбо', 'Сумма (тг)'];
    const rows = bookings.map((b) => [
      b.id,
      formatKzDateTime(b.startDatetime),
      b.name,
      b.phone,
      zoneLabel(b.zone),
      b.durationMinutes,
      b.withCombo ? 'да' : 'нет',
      b.totalPrice,
    ]);
    const csv = buildCsv(headers, rows);
    await ctx.replyWithDocument(
      { source: Buffer.from(csv, 'utf8'), filename: 'bookings.csv' },
      { caption: `📅 Всего броней: ${bookings.length}` },
    );
  });

  bot.command('cancel', async (ctx) => {
    const lang = getLang(ctx);
    ctx.session.step = 'idle';
    ctx.session.draft = emptyDraft();
    await ctx.reply(t(lang, 'cancel_msg'), mainKeyboard(lang));
  });

  // ── Кнопки главного меню (обе языковых версии) ─────────────────────────

  function fmtPrice(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function buildPriceText(lang) {
    const p = BASE_PRICES;
    const isKz = lang === 'kz';
    const h1 = isKz ? '1 сағат' : '1 час  ';
    const h3 = isKz ? '3 сағат' : '3 часа ';
    const h5 = isKz ? '5 сағат' : '5 часов';
    const header = isKz ? '💰 CEZAR PS5 баға тізімі' : '💰 Прайс-лист CEZAR PS5';
    const comboNote = isKz
      ? '🍔 Комбо (тамақ) — 3 және 5 сағатқа қол жетімді'
      : '🍔 Комбо (еда) — доступно при 3ч и 5ч';
    return [
      header,
      '',
      '🎮 ЗАЛ',
      `  ${h1} — ${fmtPrice(p.zal[60])} ₸`,
      `  ${h3} — ${fmtPrice(p.zal[180])} ₸`,
      `  ${h5} — ${fmtPrice(p.zal[300])} ₸`,
      '',
      '🚪 КАБИНКА',
      `  ${h1} — ${fmtPrice(p.cabinet[60])} ₸`,
      `  ${h3} — ${fmtPrice(p.cabinet[180])} ₸`,
      `  ${h5} — ${fmtPrice(p.cabinet[300])} ₸`,
      '',
      '👑 ВИП',
      `  ${h1} — ${fmtPrice(p.vip[60])} ₸`,
      `  ${h3} — ${fmtPrice(p.vip[180])} ₸`,
      `  ${h5} — ${fmtPrice(p.vip[300])} ₸`,
      '',
      comboNote,
    ].join('\n');
  }

  bot.hears(/^(💰 Прайс|💰 Баға)$/, async (ctx) => {
    const lang = getLang(ctx);
    await ctx.reply(buildPriceText(lang));
  });

  bot.hears(/^(🎮 Забронировать|🎮 Брондау)$/, async (ctx) => {
    ctx.session.draft = emptyDraft();
    ctx.session.step = 'zone';
    const lang = getLang(ctx);
    await ctx.reply(t(lang, 'zone_prompt'), zoneKeyboard());
  });

  bot.hears(/^(📅 Мои брони|📅 Менің броньдарым)$/, async (ctx) => {
    const lang = getLang(ctx);
    const uid = ctx.from.id;
    const rows = listUpcomingBookings(db, uid);
    if (!rows.length) {
      await ctx.reply(t(lang, 'no_bookings'), mainKeyboard(lang));
      return;
    }
    const lines = rows.map((r) => {
      const combo = r.with_combo ? t(lang, 'combo_label') : t(lang, 'no_combo_label');
      return (
        `#${r.id} • ${zoneLabel(r.zone)} • ${formatKzDateTime(r.start_datetime)} • ` +
        `${minutesLabel(r.duration_minutes, lang)} • ${combo} • ${r.total_price} ₸`
      );
    });
    await ctx.reply(`${t(lang, 'my_bookings_header')}\n\n${lines.join('\n')}`, mainKeyboard(lang));
    const last = getLastBooking(db, uid);
    if (last) {
      await ctx.reply(
        t(lang, 'repeat_prompt'),
        Markup.inlineKeyboard([[Markup.button.callback(t(lang, 'repeat_btn'), 'repeat:last')]]),
      );
    }
  });

  // ── Статистика (inline-кнопки периода) ────────────────────────────────

  function statsKeyboard(lang) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(t(lang, 'stats_btn_today'), 'stats:today'),
        Markup.button.callback(t(lang, 'stats_btn_week'), 'stats:week'),
        Markup.button.callback(t(lang, 'stats_btn_month'), 'stats:month'),
      ],
    ]);
  }

  bot.action(/^stats:(today|week|month)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const lang = getLang(ctx);
    if (!isOperatorCtx(ctx)) return;

    const period = ctx.match[1];
    let rangeIso, periodLabel;
    if (period === 'today') {
      rangeIso = getLocalDayRangeIso();
      periodLabel = t(lang, 'stats_btn_today');
    } else if (period === 'week') {
      rangeIso = getWeekRangeIso();
      periodLabel = t(lang, 'stats_btn_week');
    } else {
      rangeIso = getMonthRangeIso();
      periodLabel = t(lang, 'stats_btn_month');
    }

    const stats = getStatsForPeriod(db, rangeIso.start, rangeIso.end);

    if (stats.totalBookings === 0) {
      await ctx
        .editMessageText(
          `${t(lang, 'stats_header', periodLabel)}\n\n${t(lang, 'stats_empty')}`,
          statsKeyboard(lang),
        )
        .catch(() => {});
      return;
    }

    const lines = [
      t(lang, 'stats_header', periodLabel),
      '',
      t(lang, 'stats_total_bookings', stats.totalBookings),
      t(lang, 'stats_unique_clients', stats.uniqueClients),
      '',
      t(lang, 'stats_zone_zal', stats.byZone.zal),
      t(lang, 'stats_zone_cabinet', stats.byZone.cabinet),
      t(lang, 'stats_zone_vip', stats.byZone.vip),
    ];

    if (stats.review2gisSent > 0) {
      lines.push('', t(lang, 'stats_2gis_sent', stats.review2gisSent));
    }

    await ctx.editMessageText(lines.join('\n'), statsKeyboard(lang)).catch(() => {});
  });

  // ── Callback-кнопки ────────────────────────────────────────────────────

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery().catch(() => {});

    // Выбор языка
    if (data.startsWith('lang:')) {
      const chosen = data.slice(5);
      if (!['ru', 'kz'].includes(chosen)) return;
      ctx.session.lang = chosen;
      upsertUserLang(db, ctx.from.id, chosen);
      await ctx.reply(t(chosen, 'lang_set'));
      await sendWelcome(ctx);
      return;
    }

    const lang = getLang(ctx);

    if (data === 'repeat:last') {
      const last = getLastBooking(db, ctx.from.id);
      if (!last) {
        await ctx.reply(t(lang, 'booking_not_found'), mainKeyboard(lang));
        return;
      }
      ctx.session.draft = {
        zone: last.zone,
        startIso: null,
        durationMin: last.duration_minutes,
        withCombo: last.with_combo === 1,
        repeatMode: true,
      };
      ctx.session.step = 'time';
      await ctx.reply(
        t(lang, 'repeat_info', zoneLabel(last.zone), minutesLabel(last.duration_minutes, lang)),
        timeKeyboard(lang),
      );
      return;
    }

    if (data.startsWith('z:')) {
      const z = data.slice(2);
      if (!ZONES[z]) return;
      ctx.session.draft.zone = z;
      ctx.session.step = 'time';
      await ctx.reply(t(lang, 'time_prompt'), timeKeyboard(lang));
      return;
    }

    if (data.startsWith('tq:')) {
      const tm = decodeQuick(data);
      if (!tm) return;
      const r = resolveBookingDateTime(tm, lang);
      if (!r.ok) {
        await ctx.reply(`❌ ${r.error}`);
        return;
      }
      ctx.session.draft.startIso = r.iso;
      if (ctx.session.draft.repeatMode) {
        const dur = ctx.session.draft.durationMin;
        if (dur != null) {
          const v = validateBookingFitsClosing(r.iso, dur, lang);
          if (!v.ok) {
            await ctx.reply(`❌ ${v.error}`, timeKeyboard(lang));
            return;
          }
        }
        await proceedAfterTimeForRepeat(ctx);
        return;
      }
      ctx.session.step = 'duration';
      await ctx.reply(t(lang, 'duration_prompt'), durationKeyboard(lang));
      return;
    }

    if (data === 'tc') {
      ctx.session.step = 'time_custom';
      await ctx.reply(t(lang, 'time_custom_prompt'), Markup.removeKeyboard());
      return;
    }

    if (data.startsWith('d:')) {
      const min = Number(data.slice(2));
      if (![60, 180, 300].includes(min)) return;
      const startIso = ctx.session.draft.startIso;
      if (startIso) {
        const v = validateBookingFitsClosing(startIso, min, lang);
        if (!v.ok) {
          await ctx.reply(`❌ ${v.error}`, timeKeyboard(lang));
          ctx.session.step = 'time';
          return;
        }
      }
      ctx.session.draft.durationMin = min;
      if (min === 60) {
        ctx.session.draft.withCombo = false;
        ctx.session.step = 'phone';
        await ctx.reply(t(lang, 'phone_prompt'), phoneKeyboard(lang));
        return;
      }
      ctx.session.step = 'combo';
      const zone = ctx.session.draft.zone;
      const priceWithout = zone ? getPrice(zone, min, false) : null;
      const priceWith = zone ? getPrice(zone, min, true) : null;
      await ctx.reply(t(lang, 'combo_prompt', priceWithout, priceWith), comboKeyboard(lang));
      return;
    }

    if (data.startsWith('cb:')) {
      const v = data.slice(3);
      ctx.session.draft.withCombo = v === '1';
      if (ctx.session.draft.withCombo) {
        const z = ctx.session.draft.zone;
        await ctx.reply(
          t(
            lang,
            'phone_with_combo',
            zoneLabel(z),
            getPrice(z, ctx.session.draft.durationMin, true),
          ),
          phoneKeyboard(lang),
        );
      } else {
        await ctx.reply(t(lang, 'phone_prompt'), phoneKeyboard(lang));
      }
      ctx.session.step = 'phone';
      return;
    }

    if (data === 'ch') {
      ctx.session.draft = emptyDraft();
      ctx.session.step = 'zone';
      await ctx.reply(t(lang, 'zone_prompt'), zoneKeyboard());
      return;
    }

    if (data === 'cf') {
      if (ctx.session.step !== 'confirm') return;
      const d = ctx.session.draft;
      if (!d.zone || !d.startIso || !d.durationMin || d.withCombo === null) {
        await ctx.reply(t(lang, 'data_incomplete'), mainKeyboard(lang));
        return;
      }
      const closingV = validateBookingFitsClosing(d.startIso, d.durationMin, lang);
      if (!closingV.ok) {
        await ctx.reply(`❌ ${closingV.error}`, timeKeyboard(lang));
        ctx.session.step = 'time';
        return;
      }
      const startMs = new Date(d.startIso).getTime();
      const endMs = startMs + d.durationMin * 60 * 1000;
      const cap = ZONE_CAPACITY[d.zone] ?? 1;
      const { count: overlapCount, earliestEndMs } = analyzeOverlapForSlot(
        db,
        d.zone,
        startMs,
        endMs,
      );
      if (overlapCount >= cap) {
        const hint =
          earliestEndMs != null
            ? t(lang, 'earliest_hint', formatKzDateTime(new Date(earliestEndMs).toISOString()))
            : '';
        await ctx.reply(
          t(lang, 'no_slots', zoneLabel(d.zone), overlapCount, cap, hint),
          timeKeyboard(lang),
        );
        ctx.session.step = 'time';
        return;
      }
      const total = getPrice(d.zone, d.durationMin, d.withCombo === true);
      const user = ctx.from;
      const phoneRow = getUser(db, user.id);
      if (!phoneRow?.phone) {
        await ctx.reply(t(lang, 'no_phone_yet'), phoneKeyboard(lang));
        ctx.session.step = 'phone';
        return;
      }
      const booking = insertBooking(db, {
        userId: user.id,
        zone: d.zone,
        startDatetimeIso: d.startIso,
        durationMinutes: d.durationMin,
        withCombo: d.withCombo === true,
        totalPrice: total,
      });
      await ctx.reply(
        `${t(lang, 'booking_confirmed')}\n\n${buildSummaryText(d, lang)}`,
        mainKeyboard(lang),
      );
      notifyOperatorsNewBooking(bot.telegram, {
        booking,
        guestRow: phoneRow,
        guestFrom: user,
        zoneLabel: zoneLabel(d.zone),
        startLabel: formatKzDateTime(d.startIso),
        durationLabel: minutesLabel(d.durationMin, lang),
      });
      ctx.session.step = 'idle';
      ctx.session.draft = emptyDraft();
      return;
    }
  });

  // ── Контакт (номер телефона) ───────────────────────────────────────────

  bot.on('contact', async (ctx) => {
    const lang = getLang(ctx);
    const c = ctx.message.contact;
    if (c.user_id !== ctx.from.id) {
      await ctx.reply(t(lang, 'phone_own_error'));
      return;
    }
    if (ctx.session.step !== 'phone') return;
    const phone = c.phone_number;
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    upsertUserPhone(db, ctx.from.id, name, phone);
    ctx.session.step = 'confirm';
    await ctx.reply(buildSummaryText(ctx.session.draft, lang), Markup.removeKeyboard());
    await ctx.reply(t(lang, 'confirm_prompt'), confirmKeyboard(lang));
  });

  // ── Текстовые сообщения ────────────────────────────────────────────────

  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text?.startsWith('/')) return;
    const lang = getLang(ctx);

    if (ctx.session.step === 'time_custom') {
      if (!isValidTimeFormat(text)) {
        await ctx.reply(t(lang, 'time_format_error'));
        return;
      }
      const r = resolveBookingDateTime(text.trim(), lang);
      if (!r.ok) {
        await ctx.reply(`❌ ${r.error}`);
        return;
      }
      ctx.session.draft.startIso = r.iso;
      if (ctx.session.draft.repeatMode) {
        const dur = ctx.session.draft.durationMin;
        if (dur != null) {
          const v = validateBookingFitsClosing(r.iso, dur, lang);
          if (!v.ok) {
            await ctx.reply(`❌ ${v.error}`, timeKeyboard(lang));
            return;
          }
        }
        await proceedAfterTimeForRepeat(ctx);
        return;
      }
      ctx.session.step = 'duration';
      await ctx.reply(t(lang, 'duration_prompt'), durationKeyboard(lang));
      return;
    }

    if (ctx.session.step === 'phone') {
      await ctx.reply(t(lang, 'phone_manual_error'), phoneKeyboard(lang));
      return;
    }

    if (ctx.session.step === 'idle') {
      await showLangSelect(ctx);
      return;
    }
  });

  bot.catch((err, ctx) => {
    console.error('[CEZAR] handler error:', err);
    const lang = getLang(ctx);
    if (ctx?.reply) ctx.reply(t(lang, 'general_error')).catch(() => {});
  });

  return bot;
}
