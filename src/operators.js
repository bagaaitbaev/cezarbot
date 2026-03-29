/**
 * Операторы: .env → OPERATOR_TELEGRAM_IDS (через запятую, user id или group id)
 */

export function getOperatorChatIds() {
  const raw = process.env.OPERATOR_TELEGRAM_IDS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOperator(userId) {
  const ids = getOperatorChatIds();
  if (!ids.length) return false;
  const u = String(userId);
  return ids.some((id) => String(id) === u);
}

/** Проверяет и личный ID пользователя, и ID чата (группы) */
export function isOperatorCtx(ctx) {
  return isOperator(ctx.from?.id) || isOperator(ctx.chat?.id);
}

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {{ booking: object, guestRow: object | null, guestFrom: import('telegraf').Context['from'], zoneLabel: string }} p
 */
export function notifyOperatorsNewBooking(telegram, p) {
  const ids = getOperatorChatIds();
  if (!ids.length) return;

  const { booking, guestRow, guestFrom, zoneLabel } = p;
  const uname = guestFrom?.username ? `@${guestFrom.username}` : '';
  const name = guestRow?.telegram_name || [guestFrom?.first_name, guestFrom?.last_name].filter(Boolean).join(' ') || '—';
  const phone = guestRow?.phone || '—';
  const combo = booking.with_combo ? 'да' : 'нет';

  const lines = [
    '🆕 Новая бронь',
    '',
    `№ ${booking.id}`,
    `Зона: ${zoneLabel}`,
    `Начало: ${p.startLabel}`,
    `Длительность: ${p.durationLabel}`,
    `Комбо: ${combo}`,
    `Сумма: ${booking.total_price} ₸`,
    '',
    `Клиент: ${name}`,
    `Телефон: ${phone}`,
    `Telegram ID: ${guestFrom?.id ?? '—'}${uname ? ` ${uname}` : ''}`,
  ];

  const text = lines.join('\n');

  for (const chatId of ids) {
    telegram
      .sendMessage(chatId, text, { disable_web_page_preview: true })
      .then(() => console.log(`[CEZAR] Уведомление оператору ${chatId} — отправлено`))
      .catch((e) =>
        console.error('[CEZAR] Не удалось отправить сообщение оператору:', chatId, e.message),
      );
  }
}
