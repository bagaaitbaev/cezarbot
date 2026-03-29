import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = process.env.SESSION_PATH
  || path.join(__dirname, '..', '..', 'data', 'sessions.json');

function load() {
  try {
    if (fs.existsSync(SESSION_PATH)) {
      return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(data), 'utf8');
  } catch {}
}

const cache = load();

export function makeSessionStore() {
  return {
    get(key) {
      return cache[key] ?? null;
    },
    set(key, value) {
      cache[key] = value;
      save(cache);
    },
  };
}
