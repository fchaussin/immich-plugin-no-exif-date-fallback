# How it works

## The problem

Apps that strip metadata on send — WhatsApp, Messenger, Instagram — produce
files with **no EXIF segment at all**. Not a reduced EXIF: none. The capture
date is genuinely gone from the file's bytes, and no tool recovers it.

The Immich **mobile** app then sends `MediaStore.DATE_TAKEN = 0` for these
files. The server takes the earliest of the dates it is given, and zero always
wins — so the asset lands on the epoch. Uploading the very same file through the
**web** UI dates it correctly, which is what makes this so confusing.

Reported repeatedly upstream:
[#8661](https://github.com/immich-app/immich/issues/8661) (closed *not
planned*), [#3527](https://github.com/immich-app/immich/issues/3527),
[#9116](https://github.com/immich-app/immich/discussions/9116),
[#12292](https://github.com/immich-app/immich/discussions/12292).

## The insight

The date your phone *displays* — the one every file manager shows — is the
file's modification time, and it **survives the upload intact**. Immich stores
it as `fileModifiedAt`, right next to the broken `fileCreatedAt`.

So nothing is lost. The right answer was never missing; it just wasn't the one
picked. This plugin reads `fileModifiedAt` and writes it back as
`dateTimeOriginal`.

That makes it exact rather than heuristic — unlike the filename-based scripts
that circulate, which only match WhatsApp's `IMG-20250805-WA0003.jpg` pattern
and do nothing for Messenger's `Messenger_creation_<uuid>.jpg`.

> **What the date means.** For a *received* image this is the reception date,
> not the capture date — that one was destroyed on send and is unrecoverable. It
> is the best available, and it is the date your phone shows, so it is the one
> you expect when you open the photo.

## Why a plugin and not a script

Scripts against the REST API need an API key **per user**, because assets are
owned. That does not scale past a single-person library.

A workflow runs server-side as the asset's owner (`authUserId: asset.ownerId` in
`workflow-execution.service.ts`), so it repairs everyone's uploads with no key
issued to anyone. And it fires on `AssetMetadataExtraction`, so new uploads are
corrected **as they arrive** instead of being swept up afterwards.

## The decision, rule by rule

On each asset, after metadata extraction:

1. If the asset's date is **not within hours of the Unix epoch**, do nothing —
   however old it is. A scanned 1965 photograph is a real date, not a symptom.
2. Otherwise, if `fileModifiedAt` is a real date, set `dateTimeOriginal` to it.
3. If `fileModifiedAt` is *also* at the epoch, do nothing — there is nothing to
   recover, and inventing a plausible-but-wrong date is worse than leaving an
   obvious sentinel you can still find later.

### Why there is no "use today's date" mode

Rule 3 is the whole reason. The 1970 sentinel is what makes these photos
findable years afterwards, in one query. A photo silently stamped with today is
indistinguishable from one taken today, it can never be found again, and it sits
at the top of your timeline forever. A plausible wrong date is worse than an
obvious one.

`fileCreatedAt` is not offered as a source either, for a simpler reason: it is
the broken field. If it held a good date, the asset would not be on the epoch
and the plugin would not fire at all.

### Why the window, and why it is narrow

The bug lands photos on the epoch *exactly* — `Math.min` against a zero. The
window exists only because `localDateTime` is wall-clock: the same instant reads
as `1969-12-31T19:00` in UTC-5. A day either side covers every offset (max ±14 h)
and still cannot reach a plausible date.

> An earlier version treated everything before 1971 as broken. That silently
> clobbered legitimately old photos, which is exactly the failure this plugin is
> supposed to prevent.

## What the correction leaves behind

The change goes through the server's normal `assetService.update` path — the
same one the REST API and the web UI use — so Immich queues a sidecar write and
the corrected date lands in an XMP file next to the photo. It therefore also
exists **on disk**, not only in the database: it survives a re-import, and it is
picked up by whatever backs up your library.

If you have the **storage template** engine enabled, Immich also re-files the
photo under its corrected date on its own; there is no migration job to run
afterwards. With the template disabled (the default), the file stays where it
is — only its date changes, which is all the timeline needs.

## Verified end to end

On Immich **v3.1.0**, two JPEGs with no EXIF segment were uploaded with
`fileModifiedAt=2024-07-23` and different capture dates:

| Sent as | Came back as | |
|---|---|---|
| `1970-01-01` | `2024-07-23` | repaired |
| `1965-07-14` | `1965-07-14` | untouched |

No manual step, and no API key involved in the correction itself.
