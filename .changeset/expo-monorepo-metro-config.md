---
"@iv-stpn/vitest-mobile": minor
---

feat: support Expo + monorepo apps that ship their own metro.config

When the consumer app ships its own `metro.config.{js,cjs}` (every Expo/RN app, and required in Nx/pnpm monorepos), `loadMetroConfig` loads that file and skips the generated config — so the node-builtin stubs, harness module pinning, harness `watchFolders`, and global polyfills never applied, and the harness failed to boot.

**`nativePlugin({ appDir })` option** — Resolved relative to `process.cwd()`, defaults to `process.cwd()`. Mirrors the CLI `--app-dir` so the harness anchors at the app package when `vitest run` executes from the workspace root.

**`applyTestTransforms` now applies the full resolver contract** — Previously only the generated Metro config injected the node/vite/vitest stub resolver, the harness pinning (`react`/`react-native`/`@react-native/*` plus this package's expanded runtime-dep set), and the harness tree in `watchFolders`. These are now also applied in `applyTestTransforms` so they take effect when the consumer ships its own config.

**Server-root-anchored bundle URL rewrite** — Anchors the `/index.bundle` rewrite at the effective server root (`server.unstable_serverRoot ?? projectRoot`). Expo sets `unstable_serverRoot` to the monorepo root, so a projectRoot-relative path 404s.

**Global polyfills** — `FormData`, `setImmediate`, `requestAnimationFrame`, etc. installed via a Metro `getPolyfills` script so they exist before pre-main module evaluation, plus a matching runtime `FormData` shim. Real app dependency graphs reference these globals at module-top.

**Single source of truth** — `src/metro/harness-modules.cjs` exports the stub allow-list and harness-pin predicate, consumed by both the generated config and `applyTestTransforms` so the two resolver paths can't drift.
