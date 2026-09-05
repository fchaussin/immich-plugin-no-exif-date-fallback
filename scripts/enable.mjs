#!/usr/bin/env node
/**
 * enable.mjs — turn the plugin on for one account, in one command.
 *
 *   IMMICH_URL=http://immich.local:2283 IMMICH_API_KEY=… node scripts/enable.mjs
 *
 * Why this exists: a workflow belongs to a user. The server sets
 * `ownerId: auth.user.id` when creating one and offers no way to override it,
 * so nobody — not even an admin — can switch the plugin on for somebody else.
 * Each account has to do it once. That is an Immich constraint, not a choice of
 * this plugin, and this script is the shortest path through it: hand it that
 * person's API key and it is done.
 *
 * Idempotent: re-running finds the existing workflow instead of adding a second.
 *
 * No dependencies: Node 18+ (built-in fetch).
 */
const URL_BASE = (process.env.IMMICH_URL ?? 'http://localhost:2283').replace(/\/$/, '');
const KEY = process.env.IMMICH_API_KEY;
const WINDOW = Number(process.env.IMMICH_EPOCH_WINDOW_HOURS ?? 48);

const METHOD = 'immich-plugin-no-exif-date-fallback#fallbackToFileDate';
const TRIGGER = 'AssetMetadataExtraction';
const NAME = 'Fix photos dated 1 January 1970';

if (!KEY) {
  console.error('IMMICH_API_KEY is required (Immich → Account → API Keys).');
  process.exit(1);
}

const api = async (method, path, body) => {
  const res = await fetch(`${URL_BASE}/api${path}`, {
    method,
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// The plugin has to be installed server-side first; without it the workflow
// cannot resolve its step and the API rejects the whole call with a message
// that does not mention the plugin at all.
const templates = await api('GET', '/plugins/templates');
if (!templates.some((t) => t.steps?.some((s) => s.method === METHOD))) {
  console.error(`✗ the plugin is not installed on ${URL_BASE}.`);
  console.error('  Drop it in IMMICH_PLUGINS_INSTALL_FOLDER and restart the server — see the README.');
  process.exit(1);
}

const existing = (await api('GET', `/workflows?trigger=${TRIGGER}`)).find((w) =>
  w.steps?.some((s) => s.method === METHOD),
);
if (existing) {
  console.log(`✓ already enabled for this account (workflow ${existing.id})`);
  process.exit(0);
}

// The response to this POST always reports `steps: []`, whatever was sent — the
// server blanks the array on the way out. The steps are stored; read them back
// with a GET rather than believing the echo.
const { id } = await api('POST', '/workflows', {
  trigger: TRIGGER,
  name: NAME,
  enabled: true,
  steps: [{ method: METHOD, config: { epochWindowHours: WINDOW }, enabled: true }],
});

const check = await api('GET', `/workflows/${id}`);
if (!check.steps?.some((s) => s.method === METHOD)) {
  console.error(`✗ workflow ${id} was created without its step — remove it and retry.`);
  process.exit(1);
}

console.log(`✓ enabled for this account (workflow ${id}, window ${WINDOW} h)`);
console.log('  New uploads are repaired from now on. For photos already in the');
console.log('  library, run scripts/backfill.mjs once.');
