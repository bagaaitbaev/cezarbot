import { getBookingsNeedingReminder, getUser, markReminderSent } from '../db.js';
import { formatKzDateTime, minutesLabel } from '../utils/time.js';
import { ZONES } from '../config.js';
import { t, DEFAULT_LANG } from '../i18n.js';

function zoneLabel(id) {
  return ZONES[id]?.label ?? id;
}

export function startReminderJob(bot, db) {
  const tick = async () => {
    const list = getBookingsNeedingReminder(db);
    for (const b of list) {
      const user = getUser(db, b.user_id);
      const lang = user?.lang || DEFAULT_LANG;
      const text = t(
        lang,
        'reminder_text',
        zoneLabel(b.zone),
        formatKzDateTime(b.start_datetime),
        minutesLabel(b.duration_minutes, lang),
      );
      try {
        await bot.telegram.sendMessage(b.user_id, text);
        markReminderSent(db, b.id);
      } catch {
        // пользователь мог заблокировать бота
      }
    }
  };
  void tick();
  return setInterval(() => void tick(), 60_000);
}
