import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallback, isEpochSentinel } from '../src/fallback.ts';

const asset = (a: Record<string, unknown>, config?: Record<string, unknown>) =>
  fallback({ data: { asset: a }, config } as never);
const dateOf = (r: ReturnType<typeof fallback>) =>
  r.changes?.asset?.exifInfo?.dateTimeOriginal;

const EPOCH = '1970-01-01T00:00:00.000Z';

test('recovers the file date for a Messenger photo stranded on the epoch', () => {
  assert.equal(
    dateOf(asset({ localDateTime: EPOCH, fileCreatedAt: EPOCH, fileModifiedAt: '2024-03-08T13:41:13.000Z' })),
    '2024-03-08T13:41:13.000Z',
  );
});

test('leaves a correctly dated asset alone', () => {
  assert.deepEqual(
    asset({ localDateTime: '2025-06-06T18:19:15.000Z', fileModifiedAt: '2026-01-01T00:00:00.000Z' }),
    {},
  );
});

test('does NOT touch a genuinely old photo — the regression that motivated the window', () => {
  // A scanned 1965 family picture, dated by hand. The old year-based threshold
  // would have clobbered it with whatever date the file happened to carry.
  assert.deepEqual(
    asset({ localDateTime: '1965-07-14T12:00:00.000Z', fileModifiedAt: '2024-01-01T00:00:00.000Z' }),
    {},
  );
  // Same, just after the epoch: 1971 and 1972 are real dates too.
  assert.deepEqual(
    asset({ localDateTime: '1971-03-02T09:00:00.000Z', fileModifiedAt: '2024-01-01T00:00:00.000Z' }),
    {},
  );
});

test('still catches the epoch shifted by a timezone offset', () => {
  // The same instant reads as 1969-12-31T19:00 in UTC-5.
  assert.equal(
    dateOf(asset({ localDateTime: '1969-12-31T19:00:00.000Z', fileModifiedAt: '2023-02-05T12:34:26.000Z' })),
    '2023-02-05T12:34:26.000Z',
  );
});

test('does nothing when the file date is at the epoch too', () => {
  assert.deepEqual(asset({ localDateTime: EPOCH, fileCreatedAt: EPOCH, fileModifiedAt: EPOCH }), {});
});

test('falls back to fileCreatedAt when localDateTime is absent', () => {
  assert.equal(
    dateOf(asset({ fileCreatedAt: EPOCH, fileModifiedAt: '2023-02-05T12:34:26.000Z' })),
    '2023-02-05T12:34:26.000Z',
  );
});

test('honours a configured window', () => {
  // A one-hour window no longer reaches the UTC-5 shifted epoch.
  assert.deepEqual(
    asset({ localDateTime: '1969-12-31T19:00:00.000Z', fileModifiedAt: '2024-01-01T00:00:00.000Z' },
           { epochWindowHours: 1 }),
    {},
  );
});

test('ignores malformed and missing dates instead of throwing', () => {
  assert.deepEqual(asset({ localDateTime: EPOCH, fileModifiedAt: 'not a date' }), {});
  assert.deepEqual(asset({ localDateTime: EPOCH, fileModifiedAt: null }), {});
  assert.deepEqual(asset({ localDateTime: 'not a date', fileModifiedAt: '2024-01-01T00:00:00.000Z' }), {});
  assert.deepEqual(asset({}), {});
  assert.deepEqual(fallback({}), {});
});

test('isEpochSentinel draws the line where it should', () => {
  assert.equal(isEpochSentinel(EPOCH, 48), true);
  assert.equal(isEpochSentinel('1969-12-31T19:00:00.000Z', 48), true);
  assert.equal(isEpochSentinel('1970-06-01T00:00:00.000Z', 48), false);
  assert.equal(isEpochSentinel('1965-07-14T12:00:00.000Z', 48), false);
  assert.equal(isEpochSentinel('2024-01-01T00:00:00.000Z', 48), false);
  assert.equal(isEpochSentinel('', 48), false);
  assert.equal(isEpochSentinel(undefined, 48), false);
});
