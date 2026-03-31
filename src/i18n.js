export const DEFAULT_LANG = 'ru';

export const T = {
  ru: {
    lang_prompt: 'Выберите язык / Тілді таңдаңыз:',
    btn_lang_ru: '🇷🇺 Русский',
    btn_lang_kz: '🇰🇿 Қазақша',
    lang_set: 'Язык установлен: Русский.',

    welcome:
      'Добро пожаловать в CEZAR PS5 клуб! Нажмите кнопку ниже, чтобы сделать бронь.',
    btn_book: '🎮 Забронировать',
    btn_my_bookings: '📅 Мои брони',
    btn_price: '💰 Прайс',

    operator_only: 'Эта команда только для операторов CEZAR.',
    operator_only_short: 'Эта команда только для операторов.',
    operator_help:
      '🔧 Режим оператора\n\n/bugun или /today — список подтверждённых броней на сегодня.\n/stats — статистика по периодам.\n\nПри новой брони вам будет отправлено уведомление (если в .env указан OPERATOR_TELEGRAM_IDS).',
    no_bookings_today: (day) => `📅 ${day} — подтверждённых броней нет.`,
    bookings_today: (day) => `📅 Брони на сегодня (${day}):`,

    stats_period_choose: 'Выберите период:',
    stats_btn_today: 'Сегодня',
    stats_btn_week: 'Эта неделя',
    stats_btn_month: 'Этот месяц',
    stats_header: (period) => `📊 Статистика — ${period}`,
    stats_total_bookings: (n) => `Всего броней: ${n}`,
    stats_unique_clients: (n) => `Уникальных клиентов: ${n}`,
    stats_zone_zal: (n) => `ЗАЛ: ${n}`,
    stats_zone_cabinet: (n) => `КАБИНКА: ${n}`,
    stats_zone_vip: (n) => `ВИП: ${n}`,
    stats_2gis_sent: (n) => `Получили ссылку 2ГИС: ${n}`,
    stats_empty: 'За этот период броней нет.',
    combo_label: 'комбо',
    no_combo_label: 'без комбо',

    cancel_msg: 'Отменено. Возврат в главное меню.',
    zone_prompt: 'Выберите зону:',
    time_prompt: 'Выберите время:',
    duration_prompt: 'Выберите длительность:',
    combo_prompt: (priceWithout, priceWith) =>
      `🎁 Хотите добавить еду к брони?\n\n🌭 2 хот-дога + 🥤 Лимонад\n\n${priceWithout != null ? `Без комбо: ${priceWithout} ₸\nС комбо:   ${priceWith} ₸\n\n` : ''}По отдельности еда стоила бы 3 690 ₸ — с комбо экономите 840 ₸ 🔥`,

    btn_time_custom: '✏️ Ввести время вручную',
    btn_dur_1h: '1 час',
    btn_dur_3h: '3 часа',
    btn_dur_5h: '5 часов',
    btn_combo_yes: 'Да (с комбо)',
    btn_combo_no: 'Нет (только игра)',
    btn_confirm: '✅ Подтвердить',
    btn_change: '✏️ Изменить',
    btn_phone: '📱 Отправить номер',

    phone_prompt: 'Отправьте ваш номер телефона',
    phone_with_combo: (zone, price) =>
      `🍔 КОМБО: игровое время + 2 хот-дога + лимонад\n\n📍 ${zone} — ${price} ₸\n\nОтправьте ваш номер телефона`,
    phone_repeat_with_combo: (zone, price) =>
      `🍔 КОМБО: игровое время + 2 хот-дога + лимонад\n📍 ${zone} — ${price} ₸\n\nОтправьте ваш номер телефона`,
    phone_own_error: 'Отправьте свой номер (через кнопку).',
    phone_manual_error: 'Номер нужно отправить через кнопку 📱, а не вручную.',

    confirm_prompt: 'Данные верны? Подтвердите или измените.',
    summary: (z, time, dur, combo, total) =>
      `📋 Детали брони\n\n📍 Зона: ${z}\n🕐 Начало: ${time}\n⏱ Длительность: ${dur}\n🍔 Комбо: ${combo}\n\n💰 Итого: ${total} ₸`,
    combo_none_1h: 'без комбо (1 час)',
    combo_with: 'с комбо (игра + 2 хот-дога + лимонад)',
    combo_without: 'без комбо (только игра)',

    booking_confirmed:
      '✅ Бронь подтверждена! Мы напомним вам за 1 час до начала.',
    data_incomplete: 'Данные неполные. Начните заново.',
    no_phone_yet: 'Сначала отправьте номер телефона.',
    no_bookings: 'Предстоящих броней нет.',
    my_bookings_header: '📅 Ваши брони:',
    repeat_prompt: '🔁 Выбрать новое время с теми же параметрами:',
    repeat_btn: '🔁 Повторить бронь',
    booking_not_found: 'Бронь не найдена.',
    repeat_info: (zone, dur) =>
      `Последняя бронь: ${zone}, ${dur}. Выберите новое время.`,

    no_slots: (zl, count, cap, hint) =>
      `❌ В это время в зоне ${zl} нет свободных мест (${count}/${cap} — все заняты).${hint}\n\nВыберите другое время.`,
    earliest_hint: (dt) => `\n\nБлижайшее возможное время: ${dt} или позже.`,

    time_format_error:
      '❌ Неверный формат. Используйте HH:mm (например 15:45). Попробуйте ещё раз.',
    time_custom_prompt: 'Введите время в формате HH:mm (например: 15:45).',
    general_error:
      'Временная ошибка. Нажмите /start и попробуйте снова.',

    reminder_text: (zone, dt, dur) =>
      `⏰ Напоминание: ваша бронь начинается через 1 час.\n\n📍 ${zone}\n🕐 ${dt}\n⏱ ${dur}`,

    min_1h: '1 час',
    min_3h: '3 часа',
    min_5h: '5 часов',
    time_format_err: 'Формат: HH:mm (например 15:45)',
    time_range_err: (open, close) =>
      `Время должно быть в диапазоне ${open}–${close}`,
    closing_err: (dur, close, lastStart) =>
      `При выбранном времени сеанс ${dur} не вместится до закрытия. Клуб закрывается в ${close}. Для этой длительности последнее начало: ${lastStart} (1 час — до 02:00, 3 часа — до 00:00, 5 часов — до 22:00).`,
  },

  kz: {
    lang_prompt: 'Выберите язык / Тілді таңдаңыз:',
    btn_lang_ru: '🇷🇺 Русский',
    btn_lang_kz: '🇰🇿 Қазақша',
    lang_set: 'Тіл орнатылды: Қазақша.',

    welcome:
      'Сәлеметсіз бе! CEZAR PS5 клубына қош келдіңіз. Брондау үшін төмендегі батырманы басыңыз.',
    btn_book: '🎮 Брондау',
    btn_my_bookings: '📅 Менің броньдарым',
    btn_price: '💰 Баға',

    operator_only: 'Бұл команда тек CEZAR операторларына арналған.',
    operator_only_short: 'Бұл команда тек оператор үшін.',
    operator_help:
      '🔧 Оператор режимі\n\n/bugun немесе /today — бүгін расталған броньдар тізімі.\n/stats — кезеңдер бойынша статистика.\n\nЖаңа бронь расталғанда сізге хабарлама жіберіледі (егер .env ішінде OPERATOR_TELEGRAM_IDS қойылған болса).',
    no_bookings_today: (day) => `📅 ${day} — расталған броньдар жоқ.`,
    bookings_today: (day) => `📅 Бүгінгі броньдар (${day}):`,

    stats_period_choose: 'Кезеңді таңдаңыз:',
    stats_btn_today: 'Бүгін',
    stats_btn_week: 'Осы апта',
    stats_btn_month: 'Осы ай',
    stats_header: (period) => `📊 Статистика — ${period}`,
    stats_total_bookings: (n) => `Барлық броньдар: ${n}`,
    stats_unique_clients: (n) => `Бірегей клиенттер: ${n}`,
    stats_zone_zal: (n) => `ЗАЛ: ${n}`,
    stats_zone_cabinet: (n) => `КАБИНКА: ${n}`,
    stats_zone_vip: (n) => `ВИП: ${n}`,
    stats_2gis_sent: (n) => `2ГИС сілтемесін алды: ${n}`,
    stats_empty: 'Бұл кезеңде броньдар жоқ.',
    combo_label: 'комбо',
    no_combo_label: 'комбосыз',

    cancel_msg: 'Болдырылмады. Бас менюге оралу.',
    zone_prompt: 'Қай аймақты таңдайсыз?',
    time_prompt: 'Уақытты таңдаңыз:',
    duration_prompt: 'Ұзақтықты таңдаңыз:',
    combo_prompt: (priceWithout, priceWith) =>
      `🎁 Бронь-ға тамақ қосасыз ба?\n\n🌭 2 хот-дог + 🥤 Лимонад\n\n${priceWithout != null ? `Комбосыз: ${priceWithout} ₸\nКомбомен: ${priceWith} ₸\n\n` : ''}Бөлек алсаңыз 3 690 ₸ болар еді — комбомен 840 ₸ үнемдейсіз 🔥`,

    btn_time_custom: '✏️ Уақытты өзім енгіземін',
    btn_dur_1h: '1 сағат',
    btn_dur_3h: '3 сағат',
    btn_dur_5h: '5 сағат',
    btn_combo_yes: 'Иә (комбомен)',
    btn_combo_no: 'Жоқ (жай ғана ойын)',
    btn_confirm: '✅ Растау',
    btn_change: '✏️ Өзгерту',
    btn_phone: '📱 Нөмірді жіберу',

    phone_prompt: 'Телефон нөміріңізді жіберіңіз',
    phone_with_combo: (zone, price) =>
      `🍔 КОМБО: ойын уақыты + 2 хот-дог + лимонад\n\n📍 ${zone} — ${price} ₸\n\nТелефон нөміріңізді жіберіңіз`,
    phone_repeat_with_combo: (zone, price) =>
      `🍔 КОМБО: ойын уақыты + 2 хот-дог + лимонад\n📍 ${zone} — ${price} ₸\n\nТелефон нөміріңізді жіберіңіз`,
    phone_own_error: 'Өз нөміріңізді жіберіңіз (батырма арқылы).',
    phone_manual_error:
      'Телефонды тек 📱 батырмасы арқылы жіберіңіз (қолмен емес).',

    confirm_prompt: 'Деректер дұрыс па? Растаңыз немесе өзгертіңіз.',
    summary: (z, time, dur, combo, total) =>
      `📋 Бронь мәліметтері\n\n📍 Аймақ: ${z}\n🕐 Басталуы: ${time}\n⏱ Ұзақтық: ${dur}\n🍔 Комбо: ${combo}\n\n💰 Жиынтық: ${total} ₸`,
    combo_none_1h: 'комбо жоқ (1 сағат)',
    combo_with: 'комбомен (ойын + 2 хот-дог + лимонад)',
    combo_without: 'комбосыз (тек ойын)',

    booking_confirmed:
      '✅ Бронь расталды! Кездесуге дейін сізге ескерту жібереміз.',
    data_incomplete: 'Деректер толық емес. Қайта бастаңыз.',
    no_phone_yet: 'Алдымен телефон нөмірін жіберіңіз.',
    no_bookings: 'Алдағы броньдар жоқ.',
    my_bookings_header: '📅 Сіздің броньдарыңыз:',
    repeat_prompt: '🔁 Соңғы параметрлермен жаңа уақыт таңдау:',
    repeat_btn: '🔁 Қайта брондау',
    booking_not_found: 'Бронь табылмады.',
    repeat_info: (zone, dur) =>
      `Соңғы бронь: ${zone}, ${dur}. Жаңа уақытты таңдаңыз.`,

    no_slots: (zl, count, cap, hint) =>
      `❌ Бұл уақытта ${zl}да бос орын жоқ (${count}/${cap} — барлық орындар толы).${hint}\n\nБасқа уақыт таңдаңыз.`,
    earliest_hint: (dt) =>
      `\n\nЕң ерте бос болуы мүмкін: ${dt} немесе солдан кейін көріңіз.`,

    time_format_error:
      '❌ Формат дұрыс емес. HH:mm қолданыңыз (мысалы 15:45). Қайта жіберіңіз.',
    time_custom_prompt:
      'Уақытты HH:mm форматында жіберіңіз (мысалы: 15:45).',
    general_error: 'Уақытша қате болды. /start қайта басыңыз.',

    reminder_text: (zone, dt, dur) =>
      `⏰ Ескерту: броныңыз 1 сағаттан кейін басталады.\n\n📍 ${zone}\n🕐 ${dt}\n⏱ ${dur}`,

    min_1h: '1 сағат',
    min_3h: '3 сағат',
    min_5h: '5 сағат',
    time_format_err: 'Формат: HH:mm (мысалы 15:45)',
    time_range_err: (open, close) =>
      `Уақыт ${open}–${close} аралығында болуы керек`,
    closing_err: (dur, close, lastStart) =>
      `Таңдалған уақытпен ойын ${dur} созылғышқа сыймайды. Клуб ${close}-ге жабылады. Осы сеанс үшін ең кеш басталу: ${lastStart} (1 сағат — 02:00, 3 сағат — 00:00, 5 сағат — 22:00 дейін).`,
  },
};

/**
 * Возвращает строку или вызывает функцию-шаблон с аргументами.
 * Если ключ не найден в lang — фоллбэк на DEFAULT_LANG.
 */
export function t(lang, key, ...args) {
  const val = T[lang]?.[key] ?? T[DEFAULT_LANG][key];
  if (typeof val === 'function') return val(...args);
  return val ?? key;
}
