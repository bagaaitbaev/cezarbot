import { describe, expect, it } from 'vitest';
import { intervalsOverlap } from '../src/utils/overlap.js';

describe('intervalsOverlap', () => {
  it('detects overlap', () => {
    expect(intervalsOverlap(0, 60, 30, 90)).toBe(true);
    expect(intervalsOverlap(0, 60, 60, 120)).toBe(false);
  });

  it('3 сағат бронь аяқталғаннан кейін келесі бос (қиылыспайды)', () => {
    const m = 60 * 1000;
    const a0 = 0;
    const a1 = 180 * m;
    const b0 = 180 * m;
    const b1 = 360 * m;
    expect(intervalsOverlap(a0, a1, b0, b1)).toBe(false);
  });

  it('3 сағат ішінде басталса — қиылысады', () => {
    const m = 60 * 1000;
    const a0 = 0;
    const a1 = 180 * m;
    const b0 = 120 * m;
    const b1 = 300 * m;
    expect(intervalsOverlap(a0, a1, b0, b1)).toBe(true);
  });
});
