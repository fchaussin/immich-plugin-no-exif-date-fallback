/**
 * date-recovery — repairs Immich assets that land on 1970-01-01.
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
 * This plugin does not guess and does not parse filenames: it reads
 * `fileModifiedAt` and writes it back as `dateTimeOriginal`.
 *
 * ── What the date means ──
 *
 * For a *received* image this is the reception date, not the capture date — that
 * one was destroyed on send and is unrecoverable. It is the best available, and
 * it is what the phone shows, so it is the date a viewer expects.
 *
 * ── Why a plugin rather than a script ──
 *
 * The workflow runs server-side as the asset's owner (`authUserId: asset.ownerId`
 * in `workflow-execution.service.ts`), so it repairs every user's uploads with
 * no API keys issued to anyone. It fires on `AssetMetadataExtraction`, so new
 * uploads are corrected as they arrive rather than swept up afterwards.
 */
import { wrapper } from '@immich/plugin-sdk';
import type { Manifest } from '../dist/index.js';

const DEFAULT_THRESHOLD_YEAR = 1971;

/** An ISO date string we can act on, or null if it is absent or itself broken. */
const usableDate = (value: unknown, thresholdYear: number): string | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getUTCFullYear() >= thresholdYear ? date.toISOString() : null;
};

export default wrapper<Manifest>({
  recoverEpochDate: ({ data, config }) => {
    const asset = (data as { asset?: Record<string, unknown> })?.asset;
    if (!asset) {
      return;
    }

    const thresholdYear =
      typeof config?.thresholdYear === 'number' ? config.thresholdYear : DEFAULT_THRESHOLD_YEAR;

    // `localDateTime` is what the timeline sorts on, so it is what a user sees
    // as wrong. Fall back to `fileCreatedAt` if the payload omits it.
    const shown = asset.localDateTime ?? asset.fileCreatedAt;
    if (usableDate(shown, thresholdYear) !== null) {
      return; // already sane — leave it alone
    }

    // Only act if the file's own date is worth harvesting. If it is epoch too,
    // there is nothing to recover and inventing one would be worse than 1970:
    // a wrong-but-plausible date is harder to spot later than an obvious sentinel.
    const recovered = usableDate(asset.fileModifiedAt, thresholdYear);
    if (recovered === null) {
      return;
    }

    // Applied by the server through `assetService.update`, which is the same
    // path the REST API uses: it reorganises the file under the storage template
    // and writes an XMP sidecar next to it, so the date also lands on disk.
    return {
      changes: {
        asset: {
          exifInfo: { dateTimeOriginal: recovered },
        },
      },
    };
  },
});
