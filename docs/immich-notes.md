# Immich quirks worth knowing

Observed on **v3.1.0**. None of these are caused by this plugin — they apply to
any external plugin, and each one fails quietly.

## Upgrading a plugin fails, and says almost nothing

Immich upserts a plugin with `ON CONFLICT (name, version)` while the `plugin`
table also carries a `UNIQUE (name)` constraint. Bump a version and the conflict
target no longer matches, so the insert dies on `plugin_name_uq`:

```
code 23505 — Key (name)=(immich-plugin-no-exif-date-fallback) already exists.
```

You get **one `WARN` at boot** and the server keeps serving the *old* version as
if nothing happened. Keeping the same version is no better: the import is
deduplicated on the manifest hash, so it is skipped outright.

The way through is to delete the row first:

```sql
DELETE FROM plugin WHERE name = 'immich-plugin-no-exif-date-fallback';
```

then restart. ⚠️ That cascades `plugin` → `plugin_method` → `workflow_step`, so
every user's workflow loses its step. The workflow row survives, empty. Delete
the empty workflow and re-run `scripts/enable.mjs` for each account.

## There is no plugin page in the UI

No admin screen, no install API — the plugin service exposes only
`search`, `get`, `searchMethods` and `searchTemplates`. Plugins are imported from
a folder on disk **at startup**, gated behind `IMMICH_ALLOW_EXTERNAL_PLUGINS` and
`IMMICH_PLUGINS_INSTALL_FOLDER`.

Workflows, on the other hand, do have a page: `/workflows`, at the top level —
not under Administration.

## A workflow belongs to one user, and cannot be created for another

`create` sets `ownerId: auth.user.id` and offers no override, and execution looks
workflows up with `search({ userId, trigger })` — by the **asset owner**. So one
workflow cannot cover a family, and an admin cannot switch a plugin on for
someone else. Every account enables it itself; `scripts/enable.mjs` reduces that
to one command.

`GET /workflows/:id/share` does not help: it exports a workflow *definition* for
someone to recreate, it grants no access.

## POST /api/workflows returns `steps: []` even when it stored them

`create` persists the steps, then returns `mapWorkflow({ ...workflow, steps: [] })`
with the array blanked. Read them back with a `GET` rather than believing the
echo — and do not "fix" it with a redundant `PUT`.

## Assets are deduplicated by checksum

Uploading the same bytes twice returns the *first* asset's id with
`status: "duplicate"`. When testing date handling, vary the file contents or you
will be reading one asset while believing you have two.
