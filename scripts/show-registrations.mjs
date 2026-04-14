#!/usr/bin/env node

import { openDb } from '../src/db.js';

const db = openDb();

console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('📝 ВСЕ ПОПЫТКИ РЕГИСТРАЦИИ:\n');

if (!db.pending_registrations || db.pending_registrations.length === 0) {
  console.log('  Нет записей о попытках регистрации');
  console.log('\n═══════════════════════════════════════════════════════════\n');
  process.exit(0);
}

const pending = db.pending_registrations.sort((a, b) =>
  b.created_at.localeCompare(a.created_at)
);

pending.forEach((reg, idx) => {
  const completedIcon = reg.status === 'completed' ? '✅' : '⏳';
  const completedText =
    reg.status === 'completed' && reg.completed_at
      ? `\n  ✓ Завершена: ${new Date(reg.completed_at).toLocaleString('ru-RU')}`
      : '';
  
  console.log(`${idx + 1}. ${completedIcon} ID: ${reg.user_id}`);
  console.log(`  👤 Имя: ${reg.telegram_name || '—'}`);
  console.log(`  📅 Попытка: ${new Date(reg.created_at).toLocaleString('ru-RU')}`);
  console.log(`  🔄 Обновлена: ${new Date(reg.updated_at).toLocaleString('ru-RU')}${completedText}`);
  console.log(`  📊 Статус: ${reg.status === 'completed' ? 'Завершена' : 'Ожидание телефона'}`);
  
  // Check if user completed registration
  const user = db.users[String(reg.user_id)];
  if (user && user.phone) {
    console.log(`  ✅ Номер сохранён: ${user.phone}`);
  }
  
  console.log('');
});

// Summary
const completed = pending.filter((r) => r.status === 'completed').length;
const incomplete = pending.filter((r) => r.status === 'pending').length;

console.log('─────────────────────────────────────────────────────────');
console.log(`📊 СТАТИСТИКА:`);
console.log(`  Всего попыток: ${pending.length}`);
console.log(`  ✅ Завершено: ${completed}`);
console.log(`  ⏳ В ожидании: ${incomplete}`);
console.log('\n═══════════════════════════════════════════════════════════\n');
