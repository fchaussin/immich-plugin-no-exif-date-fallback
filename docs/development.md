# Development

```sh
npm ci
npm test          # the decision logic, on a plain Node runtime (Node 22+)
npm run typecheck
npm run build     # → dist/plugin.wasm
```

The decision lives in `src/fallback.ts` with no Extism or Immich plumbing around
it, so the test suite runs it directly. `src/index.ts` is the shim that wires it
to the host.

## Toolchain traps

Building needs [`extism-js`](https://github.com/extism/js-pdk). Four things cost
real time here, so they are worth stating plainly:

- **Bundle to CJS, not ESM.** `extism-js` embeds QuickJS, which rejects module
  syntax: an ESM bundle dies with `Exception: unsupported keyword: export`,
  surfaced as `Error: the wizer.initialize function trapped` — which looks like a
  broken toolchain rather than a format problem. Hence `--format=cjs`.
- **Do not pre-install binaryen from your package manager.** `install.sh` ships
  pinned `wasm-merge` and `wasm-opt` builds and *skips* them when it finds those
  on `PATH`, quietly swapping a known-good toolchain for whatever the distro
  ships.
- **The compiler needs GLIBC 2.39**, so Debian 12 and Ubuntu 22.04 are too old.
  On CI that means `ubuntu-24.04` or newer.
- **`install.sh` downloads its toolchain into the working directory.** Run a
  build with the repository as CWD and you get ~350 MB of binaryen in your tree.
  It is gitignored, but build elsewhere.

## No `@immich/plugin-sdk`

That package is workspace-internal to the Immich monorepo and **is not published
to npm**, so depending on it would leave this repository uncompilable by anyone.
Its `wrapper()` is a thin shim — read `Host.inputString()`, parse, call,
`Host.outputString()` the result — reproduced in `src/index.ts`. This plugin
declares `hostFunctions: false`, so none of the SDK's host-call plumbing is
needed either.

`plugin.d.ts`, the interface file `extism-js -i` consumes, is normally generated
by `plugin-sdk prepareBuild`. For a single method with no host functions it
reduces to a few lines, so it is kept in the repository instead.

## Releasing

Tag a commit and CI does the rest:

```sh
git tag -a v0.2.1 -m "…" && git push origin v0.2.1
```

The release job refuses to publish if the tag disagrees with the manifest's
`version`, packages the folder layout Immich expects into a `.tar.gz` and a
`.zip`, and attaches checksums plus the loose files.

`fail_on_unmatched_files` is set on purpose: without it a wrong path publishes a
release *missing the plugin*, and nothing anywhere says so.
