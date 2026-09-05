// Interface file handed to `extism-js -i`. It declares the exports the host
// will call, by the exact names used in `manifest.json`.
//
// The upstream SDK generates this with `plugin-sdk prepareBuild`, but that CLI
// ships inside the unpublished @immich/plugin-sdk package. For a single method
// with `hostFunctions: false`, the generated file reduces to this — so it is
// kept in the repository and stays readable.
declare module 'main' {
  export function fallbackToFileDate(): I32;
}
