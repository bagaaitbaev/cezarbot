# CEZAR Admin

Minimal web admin panel for club staff. It reads and writes the same booking
database as the Telegram and WhatsApp bots.

## Start

```bash
npm run start:admin
```

Open:

```text
http://localhost:3000
```

## Environment

```env
ADMIN_PORT=3000
ADMIN_USER=admin
ADMIN_PASSWORD=change-this-password
ADMIN_SESSION_SECRET=change-this-long-random-string
```

For multiple staff accounts, use `ADMIN_USERS`:

```env
ADMIN_USERS=admin:password:Админ:admin;arina:password2:Арина:staff
```

Format:

```text
login:password:display name:role
```

When `ADMIN_USERS` is set, it replaces `ADMIN_USER` and `ADMIN_PASSWORD`.
Manual bookings record which staff account created, edited, or cancelled them.

The panel supports:

- viewing bookings by day and zone
- creating staff bookings from calls or walk-ins
- editing date, time, zone, duration, combo, client and note
- cancelling bookings
- seeing the source: Telegram, WhatsApp, or staff

On the VPS, run it with PM2:

```bash
pm2 start npm --name cezar-admin -- run start:admin
pm2 save
```
