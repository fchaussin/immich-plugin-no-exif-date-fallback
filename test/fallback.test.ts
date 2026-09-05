import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fallback, usableDate } from '../src/fallback.ts';

const asset = (a: Record<string, unknown>, config?: Record<string, unknown>) =>
  fallback({ data: { asset: a }, config } as never);

const EPOCH = '1970-01-01T00:00:00.000Z';

test('recovers the file date for a Messenger photo stranded on the epoch', () => {
  const result = asset({
    localDateTime: EPOCH,
    fileCreatedAt: EPOCH,
    fileModifiedAt: '2024-03-08T13:41:13.000Z',
  });
  assert.equal(result.changes?.asset?.exifInfo?.dateTimeOriginal, '2024-03-08T13:41:13.000Z');
});

test('leaves a correctly dated asset alone', () => {
  const result = asset({
    localDateTime: '2025-06-06T18:19:15.000Z',
    fileModifiedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.deepEqual(result, {});
});

test('does nothing when the file date is at the epoch too', () => {
  const result = asset({ localDateTime: EPOCH, fileCreatedAt: EPOCH, fileModifiedAt: EPOCH });
  assert.deepEqual(result, {});
});

test('falls back to fileCreatedAt when localDateTime is absent', () => {
  const result = asset({ fileCreatedAt: EPOCH, fileModifiedAt: '2023-02-05T12:34:26.000Z' });
  assert.equal(result.changes?.asset?.exifInfo?.dateTimeOriginal, '2023-02-05T12:34:26.000Z');
});

test('honours a configured threshold year', () => {
  // With the threshold at 2024, a 2023 date counts as broken and 2025 wins.
  const result = asset(
    { localDateTime: '2023-02-05T12:34:26.000Z', fileModifiedAt: '2025-06-06T18:19:15.000Z' },
    { thresholdYear: 2024 },
  );
  assert.equal(result.changes?.asset?.exifInfo?.dateTimeOriginal, '2025-06-06T18:19:15.000Z');
});

test('ignores malformed and missing dates instead of throwing', () => {
  assert.deepEqual(asset({ localDateTime: EPOCH, fileModifiedAt: 'not a date' }), {});
  assert.deepEqual(asset({ localDateTime: EPOCH, fileModifiedAt: null }), {});
  assert.deepEqual(asset({}), {});
  assert.deepEqual(fallback({}), {});
});

test('usableDate rejects anything before the threshold', () => {
  assert.equal(usableDate(EPOCH, 1971), null);
  assert.equal(usableDate('2024-03-08T13:41:13.000Z', 1971), '2024-03-08T13:41:13.000Z');
  assert.equal(usableDate('', 1971), null);
  assert.equal(usableDate(undefined, 1971), null);
});
