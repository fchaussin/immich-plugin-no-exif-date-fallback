# immich-plugin-no-exif-date-fallback

An [Immich](https://immich.app) plugin for photos that arrive **with no EXIF
date at all** — the ones WhatsApp, Messenger and Instagram strip on send — and
therefore land on **1 January 1970** in your timeline.

It falls back to the date the file itself carries: the one your phone displays,
which survives the upload intact.

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

1. If the asset's date is **not within hours of the Unix epoch**, do nothing —
   however old it is. A scanned 1965 photograph is a real date, not a symptom.
2. Otherwise, if `fileModifiedAt` is a real date, set `dateTimeOriginal` to it.
3. If `fileModifiedAt` is *also* at the epoch, do nothing — there is nothing to
   recover, and inventing a plausible-but-wrong date is worse than leaving an
   obvious sentinel you can still find later.

That last rule is why the plugin has no "use today's date" mode. The 1970
sentinel is what makes these photos findable years afterwards, in one query;
a photo silently stamped with today is indistinguishable from one taken today,
and it sits at the top of your timeline forever.

The change goes through the server's normal `assetService.update` path — the
same one the REST API and the web UI use — so Immich queues a sidecar write and
the corrected date lands in an XMP file next to the photo. It therefore also
exists **on disk**, not only in the database: it survives a re-import, and it is
picked up by whatever backs up your library.

If you have the **storage template** engine enabled, Immich also re-files the
photo under its corrected date on its own; there is no migration job to run
afterwards. With the template disabled (the default), the file stays where it
is — only its date changes, which is all the timeline needs.

### Configuration

| Option | Default | Meaning |
|---|---|---|
| `epochWindowHours` | `48` | How far from 1 January 1970 a date can sit and still count as the sentinel. |

The bug lands photos on the epoch *exactly* — `Math.min` against a zero — so the
match is deliberately narrow. The window exists only because `localDateTime` is
wall-clock: the same instant reads as `1969-12-31T19:00` in UTC-5. A day either
side covers every offset (max ±14 h) and still cannot reach a plausible date.

> An earlier version treated everything before 1971 as broken. That silently
> clobbered legitimately old photos, which is exactly the failure this plugin is
> supposed to prevent.

## Requirements

Immich **v3.0.0 or later** — the plugin system does not exist before that.
Developed and tested against **v3.1.0**.

> ⚠️ Immich's workflow/plugin system is a **preview** feature. Its SDK is
> expected to change, and this plugin may need updating across Immich releases.

## Build

Every push is built by [CI](.github/workflows/ci.yml), and tagged commits publish
`plugin.wasm` and `manifest.json` to
[Releases](https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/releases)
— so you do not need a local toolchain to get a binary.

To build it yourself you need [`extism-js`](https://github.com/extism/js-pdk)
and [binaryen](https://github.com/WebAssembly/binaryen) (`wasm-merge`,
`wasm-opt`) on your `PATH`:

```sh
npm ci
npm test          # the decision logic, on a plain Node runtime
npm run build     # → dist/plugin.wasm
```

Two things that cost time if you build a plugin of your own:

- **Bundle to CJS, not ESM.** `extism-js` embeds QuickJS, which rejects module
  syntax outright: an ESM bundle dies with `Exception: unsupported keyword:
  export`, surfaced as `Error: the wizer.initialize function trapped` — which
  looks like a broken toolchain rather than a format problem. Hence
  `--format=cjs` in the build script.
- **Do not pre-install binaryen from your package manager.** `install.sh` ships
  pinned `wasm-merge` and `wasm-opt` builds, and *skips* them when it finds
  those binaries already on PATH — quietly swapping a known-good toolchain for
  whatever the distro ships.

The compiler binary also needs GLIBC 2.39 or newer, so Debian 12 and Ubuntu
22.04 are too old to run it.

## Install

There is **no plugin page in the Immich UI**, and no install API — the server
imports external plugins from a folder on disk at startup
(`WorkflowExecutionService.onPluginSync`). Two environment variables gate it:

| Variable | Value |
|---|---|
| `IMMICH_ALLOW_EXTERNAL_PLUGINS` | `true` (defaults to `false`) |
| `IMMICH_PLUGINS_INSTALL_FOLDER` | a directory the server can read |

Every **sub-directory** of that folder is imported, and each must look like this
— the layout this repository already produces:

```
<install folder>/
└── immich-plugin-no-exif-date-fallback/
    ├── manifest.json
    └── dist/
        └── plugin.wasm      ← the manifest's `wasmPath`, relative to the folder
```

With Docker Compose:

```yaml
services:
  immich-server:
    environment:
      IMMICH_ALLOW_EXTERNAL_PLUGINS: 'true'
      IMMICH_PLUGINS_INSTALL_FOLDER: /plugins
    volumes:
      - ./immich-plugins:/plugins:ro
```

Then grab the tarball from the
[latest release](https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/releases/latest),
extract it into that folder, and **restart the server** — the import only runs at
startup:

```sh
curl -fsSL -O https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/releases/latest/download/immich-plugin-no-exif-date-fallback-v0.2.0.tar.gz
tar -xzf immich-plugin-no-exif-date-fallback-v0.2.0.tar.gz -C /path/to/your/plugins/folder
docker compose restart immich-server
docker compose logs immich-server | grep -i plugin
```

You should see `Loaded plugin: immich-plugin-no-exif-date-fallback@0.2.0`. If
the manifest is rejected, the log lists exactly which fields failed validation.

### Upgrading is not just dropping in a new build

Two separate traps, both silent:

- **Same version, changed files → nothing happens.** The server skips a plugin
  whose *manifest hash* it already holds, so replacing `plugin.wasm` alone
  leaves the old bytes loaded.
- **New version → the import fails.** Immich upserts with
  `ON CONFLICT (name, version)` while the table also carries a `UNIQUE (name)`
  constraint, so a version change misses the conflict target and dies on
  `plugin_name_uq`. All you get is one `WARN` at boot; the server keeps serving
  the *old* version as if nothing happened.

So an in-place upgrade means removing the plugin first:

```sql
DELETE FROM plugin WHERE name = 'immich-plugin-no-exif-date-fallback';
```

then restart. ⚠️ That cascades through `plugin_method` to `workflow_step`, so
every user's workflow loses its step — the workflow row survives, empty. Delete
the empty workflow and re-run `scripts/enable.mjs` for each account afterwards.

*(Observed on v3.1.0. This is an Immich bug, not a plugin one — it applies to
any external plugin.)*

Once loaded, enable it for an account with one command:

```sh
IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/enable.mjs
```

It is idempotent, and it checks the plugin is actually installed first — without
that, the API rejects the workflow with a message that never mentions plugins.

The plugin also ships a workflow template (*Fix photos dated 1 January 1970*)
for anyone preferring the UI, at `/workflows` — a top-level page, not something
under Administration. A workflow belongs to a user (`workflow.ownerId` is `NOT NULL`), so it
is enabled per account — a click at account-creation time, with no secret to
hand out. The plugin binary itself is installed once, server-wide.

Creating the workflow over the API rather than in the UI is a single call — but
its **response always reports `steps: []`**, whatever you sent
(`mapWorkflow({ ...workflow, steps: [] })` in `workflow.service.ts`). The steps
*are* stored; only the echo is empty. Confirm with a `GET` rather than believing
the `POST`, and do not "fix" it with a redundant `PUT`.

```sh
id=$(curl -sX POST "$IMMICH_URL/api/workflows" -H "x-api-key: $KEY" \
  -H 'Content-Type: application/json' -d '{
    "trigger": "AssetMetadataExtraction",
    "name": "Fix photos dated 1 January 1970",
    "enabled": true,
    "steps": [{
      "method": "immich-plugin-no-exif-date-fallback#fallbackToFileDate",
      "config": { "epochWindowHours": 48 },
      "enabled": true
    }]
  }' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

curl -s "$IMMICH_URL/api/workflows/$id" -H "x-api-key: $KEY"   # steps are there
```

`ownerId` is taken from the authenticated caller and cannot be set
(`ownerId: auth.user.id`), so an admin cannot create a workflow on someone
else's behalf: each account enables it itself. `GET /api/workflows/:id/share`
exports a workflow *definition* for someone else to recreate — it does not grant
anyone access to yours.

## Verified end to end

On Immich **v3.1.0**, a 160-byte JPEG with no EXIF segment was uploaded with
`fileCreatedAt=1970-01-01` and `fileModifiedAt=2024-07-23` — the exact shape the
mobile app produces for a Messenger image. With the workflow enabled the asset
came back as:

```
fileCreatedAt    2024-07-23T16:38:20.000Z
localDateTime    2024-07-23T16:38:20.000Z
dateTimeOriginal 2024-07-23T16:38:20+00:00
```

No manual step, no API key involved in the correction itself.

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
