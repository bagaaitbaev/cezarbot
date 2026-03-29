/**
 * Барлық броньдар мен клиенттерді бір CSV файлына шығару (Excel ашады).
 * Іске қосу: npm run export:data
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const storePath = process.env.DB_PATH || path.join(root, 'data', 'store.json');
const outPath = path.join(root, 'data', 'bookings_export.csv');

/** Орыс тілді Excel үшін (;) — файлды екі рет басып ашқанда бағандар дұрыс бөлінеді */
const SEP = ';';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

if (!fs.existsSync(storePath)) {
  console.error('Файл жоқ:', storePath);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const users = data.users || {};
const bookings = data.bookings || [];

const header = [
  'booking_id',
  'user_id',
  'telegram_name',
  'phone',
  'zone',
  'start_datetime',
  'duration_minutes',
  'with_combo',
  'total_price',
  'status',
  'created_at',
];

const lines = [header.join(SEP)];

for (const b of bookings) {
  const u = users[String(b.user_id)] || {};
  lines.push(
    [
      csvCell(b.id),
      csvCell(b.user_id),
      csvCell(u.telegram_name),
      csvCell(u.phone),
      csvCell(b.zone),
      csvCell(b.start_datetime),
      csvCell(b.duration_minutes),
      csvCell(b.with_combo),
      csvCell(b.total_price),
      csvCell(b.status),
      csvCell(b.created_at),
    ].join(SEP),
  );
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, '\uFEFF' + lines.join('\n'), 'utf8');
console.log('Жазылды:', outPath, '(жолдар:', bookings.length + 1, ')');
