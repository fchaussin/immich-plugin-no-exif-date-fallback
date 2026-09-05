/**
 * The decision, with no Extism or Immich plumbing around it — so it can be
 * unit-tested on a plain Node runtime. `index.ts` is the thin shim that wires
 * this to the host.
 *
 * ── The bug this works around ──
 *
 * Apps that strip metadata on send (WhatsApp, Messenger, Instagram) produce
 * files with *no EXIF segment at all* — not an impoverished EXIF, none. The
 * capture date is genuinely gone from the file's content, and no tool will
 * recover it. Filename heuristics only help for WhatsApp's `IMG-20250805-WA…`
 * pattern; Messenger's `Messenger_creation_<uuid>.jpg` carries nothing.
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

export const DEFAULT_THRESHOLD_YEAR = 1971;

export type Asset = {
  localDateTime?: string | null;
  fileCreatedAt?: string | null;
  fileModifiedAt?: string | null;
};

export type Payload = {
  data?: { asset?: Asset };
  config?: { thresholdYear?: number };
};

export type Response = {
  changes?: { asset?: { exifInfo?: { dateTimeOriginal: string } } };
};

/** An ISO date string we can act on, or null if it is absent or itself broken. */
export const usableDate = (value: unknown, thresholdYear: number): string | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCFullYear() >= thresholdYear ? date.toISOString() : null;
};

export const fallback = (payload: Payload): Response => {
  const asset = payload.data?.asset;
  if (!asset) {
    return {};
  }

  const thresholdYear =
    typeof payload.config?.thresholdYear === 'number'
      ? payload.config.thresholdYear
      : DEFAULT_THRESHOLD_YEAR;

  // `localDateTime` is what the timeline sorts on, so it is what a user sees as
  // wrong. Fall back to `fileCreatedAt` if the payload omits it.
  const shown = asset.localDateTime ?? asset.fileCreatedAt;
  if (usableDate(shown, thresholdYear) !== null) {
    return {}; // already sane — leave it alone
  }

  // Only act if the file's own date is worth harvesting. If it is at the epoch
  // too there is nothing to recover, and inventing a plausible-but-wrong date
  // would be worse than 1970: an obvious sentinel is still findable later.
  const recovered = usableDate(asset.fileModifiedAt, thresholdYear);
  if (recovered === null) {
    return {};
  }

  // Applied by the server through `assetService.update`, which is the same path
  // the REST API uses: it reorganises the file under the storage template and
  // writes an XMP sidecar next to it, so the date also lands on disk.
  return { changes: { asset: { exifInfo: { dateTimeOriginal: recovered } } } };
};
