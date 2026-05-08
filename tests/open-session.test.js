import { describe, expect, it } from 'vitest';
import { analyzeOverlapForSlot, effectiveBookingEndMs, getBookingsNeedingReview2gis } from '../src/db.js';

const hour = 60 * 60 * 1000;
const start = '2026-05-08T10:00:00.000Z';

function dbWithBooking(patch = {}) {
  return {
    users: {},
    bookings: [
      {
        id: 1,
        user_id: 'user-1',
        zone: 'zal',
        seat: '1',
        start_datetime: start,
        duration_minutes: 180,
        status: 'booked',
        review_2gis_eligible: 1,
        review_2gis_sent: 0,
        ...patch,
      },
    ],
  };
}

describe('open sessions', () => {
  it('blocks the slot indefinitely until staff closes it', () => {
    const db = dbWithBooking({ open_session_started_at: '2026-05-08T13:00:00.000Z' });
    const result = analyzeOverlapForSlot(db, 'zal', new Date(start).getTime() + 5 * hour, new Date(start).getTime() + 6 * hour);

    expect(result.count).toBe(1);
    expect(result.earliestEndMs).toBeNull();
    expect(effectiveBookingEndMs(db.bookings[0])).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses the real close time after the open session is closed', () => {
    const db = dbWithBooking({
      open_session_started_at: '2026-05-08T13:00:00.000Z',
      open_session_closed_at: '2026-05-08T13:30:00.000Z',
    });
    const result = analyzeOverlapForSlot(db, 'zal', new Date('2026-05-08T13:15:00.000Z').getTime(), new Date('2026-05-08T13:45:00.000Z').getTime());

    expect(result.count).toBe(1);
    expect(new Date(result.earliestEndMs).toISOString()).toBe('2026-05-08T13:30:00.000Z');
  });

  it('does not request a review while the session is still open', () => {
    const db = dbWithBooking({
      start_datetime: new Date(Date.now() - 6 * hour).toISOString(),
      open_session_started_at: new Date(Date.now() - 3 * hour).toISOString(),
    });

    expect(getBookingsNeedingReview2gis(db)).toHaveLength(0);
  });
});
