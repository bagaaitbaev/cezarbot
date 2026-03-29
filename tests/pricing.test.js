import { describe, expect, it } from 'vitest';
import { getPrice } from '../src/pricing.js';

describe('getPrice', () => {
  it('1 сағат — комбо жоқ', () => {
    expect(getPrice('zal', 60, false)).toBe(1000);
  });
  it('Зал 3 сағат комбо', () => {
    expect(getPrice('zal', 180, true)).toBe(4850);
  });
  it('ВИП 5 сағат комбосыз', () => {
    expect(getPrice('vip', 300, false)).toBe(7500);
  });
});
