---
"@iv-stpn/vitest-mobile": patch
---

fix(metro): expand HARNESS_PINNED, add disk fallback resolver, disable watchman for output dir, add noop toolLauncher

Four bundler fixes that unblock Android (and iOS) test runs:

**HARNESS_PINNED expansion** — Added `@babel/runtime`, `chai`, `flatted`, `pathe`, `signalium`, `@shopify/restyle`, `@vitest/expect`, `@vitest/runner`, `@vitest/utils` to the set of packages always resolved from the harness tree. Without this, Metro would fail with `MODULE_NOT_FOUND` for packages only installed under the harness node_modules.

**Disk fallback resolver** — The generated entry file (`.vitest-mobile/index.<platform>.js`) lives in a gitignored output directory. Watchman respects `.gitignore` and excludes those files from its file map, causing Metro's resolver to report "None of these files exist". A narrow `resolveOnDisk()` fallback checks the filesystem directly for paths under `.vitest-mobile/`, bypassing the file map only for that directory.

**`useWatchman: false`** — Metro also needs the entry file in the file map to compute its SHA-1 for caching. Switching to the Node fs crawler (which does not respect `.gitignore`) includes the output dir in the file map. HMR and file watching still work via `fs.watch`.

**Noop toolLauncher** — `createDevMiddleware` throws "DefaultToolLauncher must be mocked or overridden in tests" when `NODE_ENV=test`. Passing a no-op implementation avoids this without affecting real debug functionality.
