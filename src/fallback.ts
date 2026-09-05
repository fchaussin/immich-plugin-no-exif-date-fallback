/**
 * The decision, with no Extism or Immich plumbing around it — so it can be
 * unit-tested on a plain Node runtime. `index.ts` is the thin shim that wires
 * this to the host.
 *
 * ── The bug this works around ──
 *
 * Apps that strip metadata on send (WhatsApp, Messenger, Instagram) can produce
 * files with *no EXIF segment at all* — not an impoverished EXIF, none. Whether
 * it happens depends on the app, its version and how the image was sent, so it
 * affects some photos and not others. When it does, the capture date is
 * genuinely gone from the file's content and no tool will recover it. Filename
 * heuristics only help for WhatsApp's `IMG-20250805-WA…` pattern; Messenger's
 * `Messenger_creation_<uuid>.jpg` carries nothing.
 *
 * But the date the phone *displays* — the one every file manager shows — is the
 * file's modification time, and it survives the upload intact. Immich stores it
 * as `fileModifiedAt`. What breaks is upstream of that: the mobile client sends
 * `MediaStore.DATE_TAKEN = 0`, the server takes the earliest of the dates it is
 * given, and zero always wins. See immich-app/immich#8661, #3527, #9116.
 *
 * So the correct date is already in the database, sitting next to the wrong one.
 * This does not guess and does not parse filenames: it reads `fileModifiedAt`
 * and writes it back as `dateTimeOriginal`.
 *
 * ── What the date means ──
 *
 * For a *received* image this is the reception date, not the capture date — that
 * one was destroyed on send and is unrecoverable. It is the best available, and
 * it is what the phone shows, so it is the date a viewer expects.
 */

/**
 * The bug produces the Unix epoch EXACTLY — `Math.min` against a zero, not "some
 * date in 1970". So the sentinel is matched precisely rather than by year.
 *
 * An earlier version treated everything before 1971 as broken. That silently
 * clobbered legitimately old photos: a scan of a 1965 family picture, dated by
 * hand, would have been "corrected" to the date its file happened to carry. The
 * window below is the whole guard against that class of false positive — a
 * digitised photo is only ever touched if it sits within hours of the epoch,
 * which no real capture date does.
 *
 * The window exists at all because `localDateTime` is wall-clock: the same
 * instant reads as 1969-12-31T19:00 in UTC-5. A day either side covers every
 * offset (max ±14 h) with room to spare, and still cannot reach a plausible
 * date.
 */
export const DEFAULT_EPOCH_WINDOW_HOURS = 48;

const EPOCH_MS = 0;

export type Asset = {
  localDateTime?: string | null;
  fileCreatedAt?: string | null;
  fileModifiedAt?: string | null;
};

export type Payload = {
  data?: { asset?: Asset };
  config?: { epochWindowHours?: number };
};

export type Response = {
  changes?: { asset?: { exifInfo?: { dateTimeOriginal: string } } };
};

const parse = (value: unknown): Date | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** True when a date sits close enough to the epoch to be the sentinel, not a real date. */
export const isEpochSentinel = (value: unknown, windowHours: number): boolean => {
  const date = parse(value);
  return date !== null && Math.abs(date.getTime() - EPOCH_MS) <= windowHours * 3_600_000;
};

export const fallback = (payload: Payload): Response => {
  const asset = payload.data?.asset;
  if (!asset) {
    return {};
  }

  const windowHours =
    typeof payload.config?.epochWindowHours === 'number'
      ? payload.config.epochWindowHours
      : DEFAULT_EPOCH_WINDOW_HOURS;

  // `localDateTime` is what the timeline sorts on, so it is what a user sees as
  // wrong. Fall back to `fileCreatedAt` if the payload omits it.
  const shown = asset.localDateTime ?? asset.fileCreatedAt;
  if (!isEpochSentinel(shown, windowHours)) {
    return {}; // a real date, however old — leave it alone
  }

  // Only act if the file's own date is worth harvesting. If it is at the epoch
  // too there is nothing to recover, and inventing a plausible-but-wrong date
  // would be worse than 1970: an obvious sentinel is still findable later.
  const recovered = parse(asset.fileModifiedAt);
  if (recovered === null || isEpochSentinel(asset.fileModifiedAt, windowHours)) {
    return {};
  }

  // Applied by the server through `assetService.update`, the same path the REST
  // API and web UI use: it queues a sidecar write, so the corrected date lands
  // in an XMP file on disk and not only in the database. Servers with the
  // storage template engine enabled also re-file the photo under its new date.
  return { changes: { asset: { exifInfo: { dateTimeOriginal: recovered.toISOString() } } } };
};
