import { Markup } from 'telegraf';
import { getBookingsNeedingReview2gis, markReview2gisSent } from '../db.js';

const REVIEW_TEXT =
  'Рахмет, CEZAR-да болғаныңызға! 2ГИС-тегі бағалауыңыз бізге өте маңызды.\n\n' +
  'Спасибо за визит в CEZAR! Ваша оценка на 2ГИС очень нам помогает.';

function reviewUrl() {
  return process.env.TWO_GIS_REVIEW_URL?.trim() ?? '';
}

export function startReview2gisJob(bot, db) {
  const tick = async () => {
    const url = reviewUrl();
    if (!url) return;

    const list = getBookingsNeedingReview2gis(db);
    const kb = Markup.inlineKeyboard([Markup.button.url('⭐ 2ГИС', url)]);

    for (const b of list) {
      try {
        await bot.telegram.sendMessage(b.user_id, REVIEW_TEXT, kb);
        markReview2gisSent(db, b.id);
      } catch {
        // пользователь мог заблокировать бота
      }
    }
  };
  void tick();
  return setInterval(() => void tick(), 180_000);
}
