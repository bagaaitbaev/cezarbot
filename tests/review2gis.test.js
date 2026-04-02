import { describe, expect, it } from 'vitest';
import { getBookingsNeedingReview2gis } from '../src/db.js';

function mockDb(bookings) {
  return { bookings };
}

describe('getBookingsNeedingReview2gis', () => {
  it('ignores bookings without review_2gis_eligible (old records)', () => {
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const db = mockDb([
      {
        id: 1,
        status: 'booked',
        start_datetime: start,
        duration_minutes: 60,
        reminder_sent: 0,
      },
    ]);
    expect(getBookingsNeedingReview2gis(db)).toHaveLength(0);
  });

  it('picks eligible booking after end + 60 min', () => {
    const start = new Date(Date.now() - 130 * 60 * 1000).toISOString();
    const db = mockDb([
      {
        id: 2,
        status: 'booked',
        start_datetime: start,
        duration_minutes: 60,
        review_2gis_eligible: 1,
        review_2gis_sent: 0,
      },
    ]);
    expect(getBookingsNeedingReview2gis(db)).toHaveLength(1);
  });

  it('does not pick before end + 60 min', () => {
    const start = new Date(Date.now() - 80 * 60 * 1000).toISOString();
    const db = mockDb([
      {
        id: 3,
        status: 'booked',
        start_datetime: start,
        duration_minutes: 60,
        review_2gis_eligible: 1,
        review_2gis_sent: 0,
      },
    ]);
    expect(getBookingsNeedingReview2gis(db)).toHaveLength(0);
  });

  it('skips when already sent', () => {
    const start = new Date(Date.now() - 130 * 60 * 1000).toISOString();
    const db = mockDb([
      {
        id: 4,
        status: 'booked',
        start_datetime: start,
        duration_minutes: 60,
        review_2gis_eligible: 1,
        review_2gis_sent: 1,
      },
    ]);
    expect(getBookingsNeedingReview2gis(db)).toHaveLength(0);
  });
});
