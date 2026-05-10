import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAllClientsForExport, insertBooking, openDb, refreshDb, upsertUserPhone } from '../src/db.js';

const originalDbPath = process.env.DB_PATH;

afterEach(() => {
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('unified clients', () => {
  it('merges Telegram and manual bookings by phone and preserves manual phone format', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cezarbot-clients-'));
    process.env.DB_PATH = path.join(dir, 'store.json');

    const db = openDb();
    upsertUserPhone(db, 420443081, 'Ersin', '77013222117');
    insertBooking(db, {
      userId: 420443081,
      zone: 'cabinet',
      seat: '6',
      startDatetimeIso: '2026-05-02T14:30:00.000Z',
      durationMinutes: 300,
      withCombo: false,
      totalPrice: 6000,
      source: 'Telegram',
    });

    upsertUserPhone(db, 'admin:77013222117', 'Ерсін', '+7 701 322 21 17', { phoneSource: 'manual' });
    insertBooking(db, {
      userId: 'admin:77013222117',
      zone: 'cabinet',
      seat: '7',
      startDatetimeIso: '2026-05-03T14:30:00.000Z',
      durationMinutes: 180,
      withCombo: false,
      totalPrice: 4000,
      source: 'Сотрудник',
    });

    refreshDb(db);
    const clients = getAllClientsForExport(db);

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      phone: '+7 701 322 21 17',
      phoneDigits: '77013222117',
      bookingCount: 2,
      visitCount: 2,
      totalSpent: 10000,
    });
    expect(clients[0].sources).toEqual(expect.arrayContaining(['Telegram', 'Сотрудник']));
    expect(db.clients['phone:77013222117'].user_ids).toEqual(expect.arrayContaining(['420443081', 'admin:77013222117']));
  });
});
