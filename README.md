# immich-plugin-no-exif-date-fallback

[![CI](https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/actions/workflows/ci.yml/badge.svg)](https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/fchaussin/immich-plugin-no-exif-date-fallback?label=release)](https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/releases/latest)
[![Immich](https://img.shields.io/badge/Immich-v3.0.0%2B-4250af)](https://immich.app)
[![Licence](https://img.shields.io/github/license/fchaussin/immich-plugin-no-exif-date-fallback)](LICENSE)

Photos received through **WhatsApp, Messenger or Instagram** arrive with their
EXIF stripped entirely, and the Immich mobile app then files them under
**1 January 1970**.

This plugin dates them from the file itself — `fileModifiedAt`, the date your
phone displays, which survives the upload intact. It does not guess and does not
parse filenames: the right value is already in Immich's database, sitting next
to the wrong one. Genuinely old photos are left alone.

→ [How it works](docs/how-it-works.md) · [Immich quirks](docs/immich-notes.md) ·
[Development](docs/development.md)

## Requirements

Immich **v3.0.0 or later** — the plugin system does not exist before that.
Tested against **v3.1.0**.

> ⚠️ Immich's workflow/plugin system is a **preview** feature. Its SDK is
> expected to change, and this plugin may need updating across Immich releases.

## Install

There is no plugin page in the Immich UI and no install API: the server imports
plugins from a folder on disk **at startup**. Point it at one:

```yaml
services:
  immich-server:
    environment:
      IMMICH_ALLOW_EXTERNAL_PLUGINS: 'true'
      IMMICH_PLUGINS_INSTALL_FOLDER: /plugins
    volumes:
      - ./immich-plugins:/plugins:ro
```

Then put the plugin in it. Either with the script — it verifies the checksum
before extracting:

```sh
curl -fsSLO https://raw.githubusercontent.com/fchaussin/immich-plugin-no-exif-date-fallback/main/scripts/install.sh
bash install.sh ./immich-plugins
```

or by hand:

```sh
curl -fsSLO https://github.com/fchaussin/immich-plugin-no-exif-date-fallback/releases/latest/download/immich-plugin-no-exif-date-fallback.tar.gz
tar -xzf immich-plugin-no-exif-date-fallback.tar.gz -C ./immich-plugins
```

Either way the archive already has the layout Immich expects
(`<name>/manifest.json` + `<name>/dist/plugin.wasm`). Then restart — plugins are
imported at startup only:

```sh
docker compose restart immich-server
docker compose logs immich-server | grep -i 'loaded plugin'
```

You are looking for `Loaded plugin: immich-plugin-no-exif-date-fallback@…`.

## Enable it, per account

The plugin is installed once for the whole server, but a workflow belongs to a
user — so each account switches it on itself. One command each:

```sh
IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/enable.mjs
```

Idempotent, and it checks the plugin is installed first. Prefer the UI? The
plugin ships a template, *Fix photos dated 1 January 1970*, at `/workflows` —
a top-level page, not under Administration.

Nobody can enable it on someone else's behalf; that is an Immich constraint,
explained in [Immich quirks](docs/immich-notes.md).

## Photos already in your library

The plugin fires on upload, so it does not touch the backlog. Sweep it once:

```sh
IMMICH_URL=… IMMICH_API_KEY=… node scripts/backfill.mjs          # dry run
IMMICH_URL=… IMMICH_API_KEY=… node scripts/backfill.mjs --apply
```

An API key only reaches its own account's assets, so a shared library needs one
run per person — which is exactly the limitation the plugin exists to avoid.

## Configuration

| Option | Default | Range | Meaning |
|---|---|---|---|
| `epochWindowHours` | `48` | `0`–`8760` | How far from 1 January 1970 a date can sit and still count as the sentinel. |

48 hours absorbs every timezone offset while leaving genuinely old photos alone.
Raising it towards `8760` (a year) will overwrite real dates from 1970 — see
[why the window is narrow](docs/how-it-works.md#why-the-window-and-why-it-is-narrow).

## Upgrading

Not just dropping in a new build: Immich cannot upgrade an external plugin in
place, and fails almost silently when you try — it needs the plugin row deleted
first, which costs every user their workflow step.

`scripts/update.sh` does it in the right order, showing which workflows it is
about to empty and asking before it touches the database. Run it **on the Docker
host**:

```sh
scripts/update.sh ./immich-plugins
```

Why any of that is necessary:
[Immich quirks](docs/immich-notes.md#upgrading-a-plugin-fails-and-says-almost-nothing).

## Licence

[AGPL-3.0-only](LICENSE), matching Immich.
