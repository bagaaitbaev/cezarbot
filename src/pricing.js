import { BASE_PRICES, COMBO_PRICES } from './config.js';

export function getPrice(zoneId, durationMin, withCombo) {
  if (durationMin === 60) {
    return BASE_PRICES[zoneId][60];
  }
  if (withCombo) {
    const c = COMBO_PRICES[zoneId][durationMin];
    if (c == null) return BASE_PRICES[zoneId][durationMin];
    return c;
  }
  return BASE_PRICES[zoneId][durationMin];
}
