# CEZAR PS5 WhatsApp bot

This is the WhatsApp Web version of the CEZAR booking bot. It does not use the
official Meta WhatsApp Business Cloud API and does not require business
verification.

## Start

```bash
npm run start:whatsapp
```

On the first run, scan the QR code printed in the terminal:

1. Open WhatsApp on your phone.
2. Go to Settings -> Linked devices.
3. Choose Link a device.
4. Scan the QR code from the terminal.

If the QR code does not fit in the terminal window, open the generated image:

```text
data/whatsapp-qr.png
```

The bot refreshes this image whenever WhatsApp sends a new QR code.

The WhatsApp Web session is stored in `.wwebjs_auth/`. User flow sessions are
stored in `data/whatsapp-sessions.json`.

## Environment

Add these values to `.env` when needed:

```env
OPERATOR_WHATSAPP_IDS=77001234567,77007654321
WHATSAPP_CLIENT_ID=cezarbot
```

`OPERATOR_WHATSAPP_IDS` accepts international phone numbers without `+`, or full
WhatsApp chat ids such as `77001234567@c.us`.

## User menu

The WhatsApp bot uses text menus:

```text
1. Забронировать
2. Мои брони
3. Прайс
4. Регистрация
5. Промокод
```

Bookings, prices, promo codes, capacity checks, reminders, and 2GIS review
messages use the same `data/store.json` database as the Telegram bot.

## Operator commands

```text
/operator
/today
/stats
/promo_list
/resetbookings
/exportclients
/exportbookings
/registrations
```

## Important limitation

This implementation automates WhatsApp Web. It is convenient for a small local
project, but it is not as stable as the official API: the account can be logged
out, the phone/account must remain active, and WhatsApp can restrict accounts
that send spam or high-volume automated messages.
