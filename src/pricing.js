import { BASE_PRICES, COMBO_PRICES } from './config.js';

export function getPrice(zoneId, durationMin, withCombo) {
  if (!zoneId || !BASE_PRICES[zoneId]) return null;
  if (durationMin === 60) {
    return BASE_PRICES[zoneId][60] ?? null;
  }
  if (withCombo) {
    const c = COMBO_PRICES[zoneId]?.[durationMin];
    if (c == null) return BASE_PRICES[zoneId][durationMin] ?? null;
    return c;
  }
  return BASE_PRICES[zoneId][durationMin] ?? null;
}
