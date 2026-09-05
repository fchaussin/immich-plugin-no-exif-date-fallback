# immich-plugin-date-recovery

An [Immich](https://immich.app) plugin that repairs photos which land on
**1 January 1970** in your timeline.

It does not guess, and it does not parse filenames. The correct date is already
in Immich's database — this plugin just uses it.

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

A workflow runs server-side as the asset's owner
(`authUserId: asset.ownerId` in `workflow-execution.service.ts`), so it repairs
everyone's uploads with no key issued to anyone. And it fires on
`AssetMetadataExtraction`, so new uploads are corrected **as they arrive**
instead of being swept up afterwards.

## Behaviour

On each asset, after metadata extraction:

1. If the asset's date is at or after `thresholdYear`, do nothing.
2. Otherwise, if `fileModifiedAt` is itself usable, set `dateTimeOriginal` to it.
3. If `fileModifiedAt` is *also* at the epoch, do nothing — there is nothing to
   recover, and inventing a plausible-but-wrong date is worse than leaving an
   obvious sentinel you can still find later.

The change goes through the server's normal `assetService.update` path, so
Immich reorganises the file under your storage template and writes an XMP
sidecar beside it. The corrected date therefore also lands **on disk**, which
means it survives a re-import and is picked up by whatever backs up your library.

### Configuration

| Option | Default | Meaning |
|---|---|---|
| `thresholdYear` | `1971` | Assets dated before 1 January of this year are treated as broken. |

## Requirements

Immich **v3.0.0 or later** — the plugin system does not exist before that.
Developed and tested against **v3.1.0**.

> ⚠️ Immich's workflow/plugin system is a **preview** feature. Its SDK is
> expected to change, and this plugin may need updating across Immich releases.

## Build

Needs [`extism-js`](https://github.com/extism/js-pdk) on your `PATH`.

```sh
npm install
npm run build     # → dist/plugin.wasm
```

## Install

Upload `dist/plugin.wasm` with its `manifest.json` through
**Administration → Plugins**. The plugin ships a workflow template
(*Recover 1970 dates*); enable it per user from **Workflows**.

The plugin binary is installed once, server-wide. Workflows are per-user, so
each account enables the template once — a click at account-creation time, with
no secret to hand out.

## Repairing photos already in your library

This plugin fires on upload, so it does not touch what is already there.
[`scripts/backfill.mjs`](scripts/backfill.mjs) applies the same logic to an
existing library over the REST API:

```sh
IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/backfill.mjs          # dry run
IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/backfill.mjs --apply
```

It needs an API key, and only sweeps the library of the account that key belongs
to — which is exactly the limitation the plugin exists to avoid. Use it once for
the backlog, then let the plugin handle everything that arrives after.

## Licence

AGPL-3.0-only, matching Immich.
