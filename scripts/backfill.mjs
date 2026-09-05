#!/usr/bin/env node
/**
 * backfill.mjs — one-shot repair of assets already in the library.
 *
 * The plugin fires on `AssetMetadataExtraction`, so it only sees uploads that
 * arrive after it is enabled. This applies the same rule to the backlog, over
 * the REST API.
 *
 *   IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/backfill.mjs
 *   IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/backfill.mjs --apply
 *
 * An API key belongs to one account and can only touch that account's assets,
 * so a multi-user library needs one run per person. That limitation is exactly
 * why the plugin exists — use this once for the backlog, not as a routine.
 *
 * No dependencies: Node 18+ (built-in fetch).
 */
const URL_BASE = (process.env.IMMICH_URL ?? 'http://localhost:2283').replace(/\/$/, '');
const KEY = process.env.IMMICH_API_KEY;
const THRESHOLD_YEAR = Number(process.env.IMMICH_THRESHOLD_YEAR ?? 1971);
const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('IMMICH_API_KEY is required (Immich → Account → API Keys).');
  console.error('Scopes needed: asset.read, asset.update');
  process.exit(1);
}

const api = async (method, path, body) => {
  const res = await fetch(`${URL_BASE}/api${path}`, {
    method,
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const usable = (value) => {
  if (typeof value !== 'string' || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear() >= THRESHOLD_YEAR ? date.toISOString() : null;
};

const cutoff = `${THRESHOLD_YEAR}-01-01T00:00:00.000Z`;
const rows = [];
for (let page = 1; ; page++) {
  const { assets } = await api('POST', '/search/metadata', { takenBefore: cutoff, page, size: 250 });
  rows.push(...assets.items);
  if (!assets.nextPage) break;
}

if (rows.length === 0) {
  console.log(`Nothing dated before ${cutoff.slice(0, 10)} — nothing to repair.`);
  process.exit(0);
}

const fixable = rows.filter((a) => usable(a.fileModifiedAt) !== null);
const orphans = rows.filter((a) => usable(a.fileModifiedAt) === null);

console.log(`${rows.length} mis-dated asset(s): ${fixable.length} recoverable, ${orphans.length} not\n`);
for (const a of fixable) {
  console.log(`  ${a.localDateTime.slice(0, 10)}  →  ${a.fileModifiedAt.slice(0, 10)}   ${a.originalFileName}`);
}
for (const a of orphans) {
  console.log(`  ! ${a.originalFileName} — fileModifiedAt (${(a.fileModifiedAt ?? '?').slice(0, 10)}) is not usable either, nothing to recover`);
}

if (!APPLY) {
  console.log('\nDry run: nothing was modified. Re-run with --apply.');
  process.exit(0);
}

let ok = 0;
for (const a of fixable) {
  const target = usable(a.fileModifiedAt);
  await api('PUT', `/assets/${a.id}`, { dateTimeOriginal: target });
  // Re-read with a GET: the PUT response serialises the asset *before* the
  // write is reflected, so trusting it reports false failures.
  const after = await api('GET', `/assets/${a.id}`);
  if ((after?.fileCreatedAt ?? '').slice(0, 10) === target.slice(0, 10)) {
    ok++;
  } else {
    console.error(`  ✗ ${a.originalFileName}: asked ${target.slice(0, 10)}, server has ${(after?.fileCreatedAt ?? '?').slice(0, 10)}`);
  }
}

console.log(`\n✓ ${ok}/${fixable.length} asset(s) re-dated.`);
if (ok > 0) {
  console.log('  Immich writes an XMP sidecar next to each photo, so the corrected');
  console.log('  date is on disk too. With the storage template engine enabled it also');
  console.log('  re-files them under the new date — nothing else to run either way.');
}
