import { describe, expect, it } from 'vitest';
import {
  formatKzDateTime,
  isValidTimeFormat,
  parseTimeParts,
  resolveBookingDateTime,
  validateBookingFitsClosing,
} from '../src/utils/time.js';

describe('isValidTimeFormat', () => {
  it('accepts HH:mm', () => {
    expect(isValidTimeFormat('15:45')).toBe(true);
    expect(isValidTimeFormat('09:05')).toBe(true);
    expect(isValidTimeFormat('0:00')).toBe(true);
  });
  it('rejects invalid', () => {
    expect(isValidTimeFormat('25:00')).toBe(false);
    expect(isValidTimeFormat('12:60')).toBe(false);
    expect(isValidTimeFormat('12-30')).toBe(false);
    expect(isValidTimeFormat('')).toBe(false);
  });
});

describe('resolveBookingDateTime', () => {
  it('uses today when time is still ahead', () => {
    const now = new Date('2026-03-28T08:00:00+05:00');
    const r = resolveBookingDateTime('15:45', 'ru', now);
    expect(r.ok).toBe(true);
    expect(r.iso).toMatch(/2026-03-28/);
  });
  it('rolls to tomorrow when time passed today', () => {
    const now = new Date('2026-03-28T18:00:00+05:00');
    const r = resolveBookingDateTime('15:45', 'ru', now);
    expect(r.ok).toBe(true);
    expect(r.iso).toMatch(/2026-03-29/);
  });
  it('accepts early morning inside overnight window', () => {
    const now = new Date('2026-03-28T20:00:00+05:00');
    const r = resolveBookingDateTime('02:30', 'ru', now);
    expect(r.ok).toBe(true);
    // ISO UTC күні 28 болуы мүмкін (+5 белдеуінде жергілікті 29.03 таңғы 02:30)
    expect(formatKzDateTime(r.iso)).toMatch(/^29\.03\.2026 02:30/);
  });
  it('rejects time outside 15:00–03:00 window', () => {
    const now = new Date('2026-03-28T16:00:00+05:00');
    expect(resolveBookingDateTime('14:00', 'ru', now).ok).toBe(false);
    expect(resolveBookingDateTime('04:00', 'ru', now).ok).toBe(false);
  });
});

describe('validateBookingFitsClosing', () => {
  it('allows 5h from 22:00 until 03:00 close', () => {
    const start = '2026-03-28T17:00:00.000Z';
    expect(validateBookingFitsClosing(start, 300).ok).toBe(true);
  });
  it('rejects 5h from 23:00 (ends after 03:00)', () => {
    const start = '2026-03-28T18:00:00.000Z';
    expect(validateBookingFitsClosing(start, 300).ok).toBe(false);
  });
  it('allows 3h from 00:00 on closing morning', () => {
    const start = '2026-03-28T19:00:00.000Z';
    expect(validateBookingFitsClosing(start, 180).ok).toBe(true);
  });
  it('rejects 1h from 02:30 (ends after 03:00)', () => {
    const start = '2026-03-28T21:30:00.000Z';
    expect(validateBookingFitsClosing(start, 60).ok).toBe(false);
  });
});

describe('parseTimeParts', () => {
  it('parses', () => {
    expect(parseTimeParts('15:45')).toEqual({ h: 15, min: 45 });
  });
});
