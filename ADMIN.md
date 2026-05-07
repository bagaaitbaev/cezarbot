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
