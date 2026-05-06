/**
 * Manual CSV export. The bot also updates these files automatically whenever
 * data/store.json changes.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { exportCsvFiles, openDb } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(root, 'data', 'store.json');
}

const db = openDb();
exportCsvFiles(db);

console.log('Exported:');
console.log(path.join(root, 'data', 'bookings_export.csv'));
console.log(path.join(root, 'data', 'clients_export.csv'));
