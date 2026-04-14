#!/usr/bin/env node

import { openDb } from '../src/db.js';

const db = openDb();

console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('✅ ЗАРЕГИСТРИРОВАННЫЕ ПОЛЬЗОВАТЕЛИ:\n');

const users = Object.values(db.users);

if (users.length === 0) {
  console.log('  Нет зарегистрированных пользователей');
  console.log('\n═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

users
  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  .forEach((user, idx) => {
    const updated = new Date(user.updated_at);
    const updated_text = updated.toLocaleString('ru-RU');
    
    console.log(`${idx + 1}. ${user.telegram_name || '—'}`);
    console.log(`  ID Telegram: ${user.user_id}`);
    console.log(`  📞 Телефон: ${user.phone || '—'}`);
    console.log(`  🌐 Язык: ${user.lang || 'не указан'}`);
    console.log(`  🕐 Зарегистрирован: ${updated_text}`);
    console.log('');
  });

console.log('─────────────────────────────────────────────────────────');
console.log(`📊 ИТОГО: ${users.length} пользователей`);
console.log('\n═══════════════════════════════════════════════════════════\n');
