/**
 * Extism entry point: the thin shim between the host and `fallback.ts`.
 *
 * ── Why no @immich/plugin-sdk ──
 *
 * That package is a workspace-internal module of the Immich monorepo and is not
 * published to npm, so depending on it would make this repository unbuildable
 * by anyone. Its `wrapper()` is a thin shim — read `Host.inputString()`, parse,
 * call, `Host.outputString()` the result — reproduced here. This plugin
 * declares `hostFunctions: false`, so none of the SDK's host-call plumbing is
 * needed either.
 */
import { fallback, type Payload } from './fallback.ts';

/** Extism's JS PDK injects this global into the guest. */
declare const Host: {
  inputString(): string;
  outputString(value: string): void;
};

/**
 * Exported under the name declared in `manifest.json` — the server calls the
 * Wasm export by that exact name.
 */
export function fallbackToFileDate(): void {
  const payload = JSON.parse(Host.inputString()) as Payload;
  Host.outputString(JSON.stringify(fallback(payload)));
}
