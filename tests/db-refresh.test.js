import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { insertBooking, listConfirmedBookingsInRange, openDb, refreshDb } from '../src/db.js';

const originalDbPath = process.env.DB_PATH;

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('file-backed db refresh', () => {
  it('shows bookings written by another db handle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cezarbot-db-'));
    process.env.DB_PATH = path.join(dir, 'store.json');

    const adminDb = openDb();
    const botDb = openDb();

    insertBooking(botDb, {
      userId: 123,
      zone: 'zal',
      seat: '1',
      startDatetimeIso: '2026-05-08T10:00:00.000Z',
      durationMinutes: 60,
      withCombo: false,
      totalPrice: 1000,
      source: 'Telegram',
    });

    const rows = listConfirmedBookingsInRange(
      adminDb,
      '2026-05-08T00:00:00.000Z',
      '2026-05-09T00:00:00.000Z',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('Telegram');
  });

  it('refreshDb updates direct db property reads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cezarbot-db-'));
    process.env.DB_PATH = path.join(dir, 'store.json');

    const first = openDb();
    const second = openDb();

    insertBooking(first, {
      userId: '77770001122@c.us',
      zone: 'vip',
      seat: '9',
      startDatetimeIso: '2026-05-08T12:00:00.000Z',
      durationMinutes: 180,
      withCombo: true,
      totalPrice: 5000,
      source: 'WhatsApp',
    });

    refreshDb(second);
    expect(second.bookings).toHaveLength(1);
    expect(second.bookings[0].source).toBe('WhatsApp');
  });
});
