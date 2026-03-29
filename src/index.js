import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDb } from './db.js';
import { createBot } from './bot.js';
import { startReminderJob } from './jobs/reminders.js';
import { startReview2gisJob } from './jobs/review2gis.js';
import { getOperatorChatIds } from './operators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Чтение .env без пакета dotenv */
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.json');
process.env.DB_PATH = dbPath;

let botRef = null;

async function main() {
  console.log('[CEZAR] Запуск…');
  const token = process.env.BOT_TOKEN?.trim();
  if (!token) {
    console.error('Ошибка: BOT_TOKEN в файле .env отсутствует или пустой.');
    console.error(
      'Откройте .env в папке проекта и вставьте токен от @BotFather в строку BOT_TOKEN=...',
    );
    process.exit(1);
  }

  const meUrl = `https://api.telegram.org/bot${token}/getMe`;
  let me;
  try {
    const res = await fetch(meUrl);
    me = await res.json();
  } catch (e) {
    console.error(
      '[CEZAR] Нет связи с api.telegram.org (интернет, брандмауэр, VPN). Ошибка:',
      e.message,
    );
    process.exit(1);
  }
  if (!me.ok) {
    console.error('[CEZAR] Токен неверный или отозван. Ответ Telegram:', me);
    process.exit(1);
  }
  console.log(`[CEZAR] Токен ОК, бот @${me.result.username} — запускается…`);

  const opIds = getOperatorChatIds();
  if (opIds.length) {
    console.log(
      `[CEZAR] Уведомления операторам: ${opIds.length} chat id (OPERATOR_TELEGRAM_IDS).`,
    );
  }

  const db = openDb();
  const bot = createBot(db);
  botRef = bot;
  startReminderJob(bot, db);
  startReview2gisJob(bot, db);

  await bot.telegram.deleteWebhook({ drop_pending_updates: true });

  // Устанавливаем описание и команды до старта поллинга,
  // потому что bot.launch() блокирует поток на всё время работы бота.
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Запустить бота / Ботты іске қосу' },
    { command: 'lang',  description: 'Сменить язык / Тілді өзгерту' },
  ]);
  await bot.telegram.setMyDescription(
    '🎮 CEZAR PS5-ке қош келдіңіз!\n\nБұл бот арқылы сіз ойын аймағын жылдам және оңай брондай аласыз — кез-келген уақытта, кезексіз.\n\n«Бастау» түймесін басыңыз 👇\n━━━━━━━━━━━━━━━━━━━━━━━\n🎮 Добро пожаловать в CEZAR PS5!\n\nЭтот бот позволяет быстро и удобно забронировать игровую зону — в любое время, без очередей.\n\nНажмите «Старт» 👇',
  );
  await bot.telegram.setMyShortDescription('🎮 CEZAR PS5 — ойын брондау · бронирование игр');

  // Даём Telegram время закрыть старое polling-соединение (если было).
  await new Promise((r) => setTimeout(r, 3_000));

  const MAX_ATTEMPTS = 30;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log('[CEZAR] Бот запущен (polling).');
      await bot.launch({ dropPendingUpdates: true });
      break;
    } catch (e) {
      if (e.response?.error_code === 409) {
        console.log(
          `[CEZAR] 409 конфликт — другой экземпляр бота ещё работает. Жду 10с... (попытка ${attempt}/${MAX_ATTEMPTS})`,
        );
        await new Promise((r) => setTimeout(r, 10_000));
      } else {
        throw e;
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

process.once('SIGINT', () => botRef?.stop('SIGINT'));
process.once('SIGTERM', () => botRef?.stop('SIGTERM'));
