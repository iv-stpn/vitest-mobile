# vitest-mobile

## 0.5.0

### Minor Changes

- d04d58d: feat(runtime): host-side `adb shell input` bridge for reliable Android headless tap and type

  Synthesized `MotionEvent`s dispatched in-process (`dispatchTouchEvent`) bypass the `InputDispatcher`'s touch-session setup, causing `onPress` to fire only ~70% of the time on Android headless emulators. `view.text.replace()` on a controlled `TextInput` was reverted by React Native's controlled-component logic before `onChangeText` reached JS. Both failures were non-deterministic and traced to Fabric's async VSYNC-gated mount cycle.

  **How it works**

  A new device→pool RPC adds two request/response round-trips over the existing WebSocket (`tapRequest`/`tapResponse` and `typeTextRequest`/`typeTextResponse`). The pool handles each by running the corresponding `adb shell` command:

  - `adb shell input tap X Y` — routes through the full `InputManager` pipeline, identical to a real finger touch, reliably received by RN's `ReactViewGroup.onTouchEvent`
  - `adb shell input text <text>` — real IME input that RN treats as user typing; `onChangeText` fires reliably without the controlled-component revert

  **`resolveStable()`**

  Fabric applies mount/unmount transactions asynchronously (VSYNC-gated). Right after a `render()`, the view tree can still contain a stale view from the previous test with the same `testID` at a wrong position. `resolveStable()` in `Locator` waits for the element's frame (`x, y, width, height`) to match across two consecutive queries before proceeding, ensuring the tap always hits the intended target.

  **Compatibility**

  The host-bridge path is Android-only (`Platform.OS === 'android'`). iOS keeps its in-process `TouchInjector` unchanged.

  **Result:** 19/19 tests pass in 6 consecutive runs on a headless arm64 Android emulator (was 1–17/19, non-deterministic).

- 06d76d1: feat: support Expo + monorepo apps that ship their own metro.config

  When the consumer app ships its own `metro.config.{js,cjs}` (every Expo/RN app, and required in Nx/pnpm monorepos), `loadMetroConfig` loads that file and skips the generated config — so the node-builtin stubs, harness module pinning, harness `watchFolders`, and global polyfills never applied, and the harness failed to boot.

  **`nativePlugin({ appDir })` option** — Resolved relative to `process.cwd()`, defaults to `process.cwd()`. Mirrors the CLI `--app-dir` so the harness anchors at the app package when `vitest run` executes from the workspace root.

  **`applyTestTransforms` now applies the full resolver contract** — Previously only the generated Metro config injected the node/vite/vitest stub resolver, the harness pinning (`react`/`react-native`/`@react-native/*` plus this package's expanded runtime-dep set), and the harness tree in `watchFolders`. These are now also applied in `applyTestTransforms` so they take effect when the consumer ships its own config.

  **Server-root-anchored bundle URL rewrite** — Anchors the `/index.bundle` rewrite at the effective server root (`server.unstable_serverRoot ?? projectRoot`). Expo sets `unstable_serverRoot` to the monorepo root, so a projectRoot-relative path 404s.

  **Global polyfills** — `FormData`, `setImmediate`, `requestAnimationFrame`, etc. installed via a Metro `getPolyfills` script so they exist before pre-main module evaluation, plus a matching runtime `FormData` shim. Real app dependency graphs reference these globals at module-top.

  **Single source of truth** — `src/metro/harness-modules.cjs` exports the stub allow-list and harness-pin predicate, consumed by both the generated config and `applyTestTransforms` so the two resolver paths can't drift.

### Patch Changes

- d04d58d: fix(android): provision arm64-compatible AVDs on Apple Silicon, fix partition size and app launch

  QEMU2 cannot emulate a foreign CPU architecture, so running Android tests on Apple Silicon (aarch64) Macs previously failed with "Avd's CPU Architecture 'x86_64' is not supported by the QEMU2 emulator on aarch64 host."

  - Auto-detect host CPU arch (`os.arch()`): default to `arm64-v8a` + `google_apis` system image on arm64 hosts, `x86_64` + `default` elsewhere
  - Expand AVD `disk.dataPartition.size` to 2 GB (default 512 MB caused out-of-space errors during harness installation)
  - Resolve the launcher component name dynamically via `cmd package resolve-activity --brief` instead of hardcoding, fixing `adb shell monkey` failures (exit 251) on physical-key-less arm64 emulators
  - Switch app launch from `adb shell monkey` to `adb shell am start -n <component>` with monkey as fallback
  - Filter AVD picker to only show AVDs whose `abi.type` matches the host architecture

- d04d58d: fix(android): triple-post `flushUIQueue` avoids headless Choreographer deadlock; `typeIntoView` sets text directly

  **`flushUIQueue`** — The previous `Choreographer.postFrameCallback` implementation waited for the next VSYNC frame. In headless mode (`-no-window`) the virtual display does not fire VSYNC while the UI is idle, so the callback never fired and any test that called `render()` or `cleanup()` deadlocked. Replaced with a triple `mainHandler.post` (mirrors iOS's triple `dispatch_async` pattern) that drains pending UI work without depending on VSYNC. A synchronous `measure()+layout()` pass is also driven here to ensure views have correct frames for coordinate queries.

  **`typeIntoView`** — The previous implementation dispatched synthesized `DOWN`/`UP` `MotionEvent`s to focus the target `EditText`, then replaced `currentFocus.text`. On Android headless the synthetic focus rarely worked, leaving `currentFocus` null and silently dropping the text. Replaced with `view.requestFocus()` + `view.text.replace()` directly on the target view resolved by `nativeId`. Mutating the `Editable` fires React Native's `TextWatcher` → `onChangeText`, so controlled components update correctly.

- bcaabd0: fix: don't delete the other platform's native dir during artifact trimming

  `trimAndroidBuildArtifacts` was deleting `projectDir/ios` and `trimIOSBuildArtifacts` was deleting `projectDir/android`. Because the scaffold is shared between platforms, this left the `.vitest-mobile-customized` marker in place while removing the native project the other build needed — causing the subsequent build to skip scaffolding and crash.

  Both trim functions now only remove their own platform's intermediates. The `isProjectReady` check in `ensureHarnessBinary` also now verifies that the native dir for the target platform exists alongside the marker, so a partially-trimmed cache entry correctly triggers a re-scaffold.

  Also fixes `typeText` on native inputs: after `typeIntoView`, the resulting `onChangeText`/`setState` re-render isn't guaranteed to have committed before the promise resolves. We now drain the UI queue and yield to JS (matching the host-bridge path) so that a subsequent `tap()` whose handler closes over the input value sees the post-type state.

- 3fbfa51: Fix all internal imports to use the scoped package name `@iv-stpn/vitest-mobile` instead of the bare `vitest-mobile` specifier, which was unresolvable at bundle and config load time.
- 124df29: fix(types): add missing type devDependencies and fix implicit any errors

  Add `@babel/core`, `@babel/types`, `@types/babel__core`, `@types/chai`,
  `metro`, `metro-config`, and `metro-resolver` as devDependencies so
  `tsc --noEmit` can resolve all type declarations.

  Fix two implicit `any` errors in `metro-runner.ts`:
  - Use `NonNullable<EnhanceMiddleware>` so TypeScript can contextually type
    the `middleware` / `metroServer` parameters (the `| undefined` union
    blocked inference).
  - Remove stale object destructuring from `metro.runServer()` — metro 0.81
    returns `HttpServer | HttpsServer` directly, not `{ httpServer }`.

- d04d58d: fix(metro): expand HARNESS_PINNED, add disk fallback resolver, disable watchman for output dir, add noop toolLauncher

  Four bundler fixes that unblock Android (and iOS) test runs:

  **HARNESS_PINNED expansion** — Added `@babel/runtime`, `chai`, `flatted`, `pathe`, `signalium`, `@shopify/restyle`, `@vitest/expect`, `@vitest/runner`, `@vitest/utils` to the set of packages always resolved from the harness tree. Without this, Metro would fail with `MODULE_NOT_FOUND` for packages only installed under the harness node_modules.

  **Disk fallback resolver** — The generated entry file (`.vitest-mobile/index.<platform>.js`) lives in a gitignored output directory. Watchman respects `.gitignore` and excludes those files from its file map, causing Metro's resolver to report "None of these files exist". A narrow `resolveOnDisk()` fallback checks the filesystem directly for paths under `.vitest-mobile/`, bypassing the file map only for that directory.

  **`useWatchman: false`** — Metro also needs the entry file in the file map to compute its SHA-1 for caching. Switching to the Node fs crawler (which does not respect `.gitignore`) includes the output dir in the file map. HMR and file watching still work via `fs.watch`.

  **Noop toolLauncher** — `createDevMiddleware` throws "DefaultToolLauncher must be mocked or overridden in tests" when `NODE_ENV=test`. Passing a no-op implementation avoids this without affecting real debug functionality.

- d04d58d: fix(pool): force `isolate: false` to prevent per-file worker teardown

  Vitest defaults `cfg.isolate` to `true`. The previous guard
  (`if (cfg.isolate === undefined)`) never fired because Vitest had already set
  the field, causing each test file to get its own worker cycle:
  `run(file) → worker.stop() → run(next file)`. `worker.stop()` tears down Metro
  and terminates the device WebSocket, so every file after the first arrived with
  no connection and the run stopped early — **only 1 of 4 test files ran**.

  The native pool requires `isolate: false` — there is a single RN JS VM per
  platform that persists across all files. The fix forces `cfg.isolate = false`
  unconditionally and emits a warning if the user had explicitly set it to `true`.

## 0.4.3

### Patch Changes

- 706afc9: Fix `bootstrap` failing on iOS for projects that depend on
  `react-native-reanimated@4`. The React Native community CLI's `--force-pods`
  path calls `pod install` with `RCT_NEW_ARCH_ENABLED='0'` even when the
  template defaults the New Architecture to on, which trips Reanimated's podspec
  assertion. The harness builder now prepends
  `ENV['RCT_NEW_ARCH_ENABLED'] = '1'` to the scaffolded Podfile so the env is
  corrected inside the same pod-install process, before any podspecs are
  evaluated.

## 0.4.2

### Patch Changes

- 60e4368: Fix `bootstrap` failing on iOS for projects that depend on
  `react-native-reanimated@4`. The React Native community CLI's `pod install`
  step was passing `RCT_NEW_ARCH_ENABLED='0'` on a virgin scaffold because its
  New Architecture detector relies on a Pods xcodeproj that doesn't exist yet,
  which Reanimated's podspec asserts against. The harness builder now pre-seeds
  the file the detector reads, so pod install runs with the New Architecture
  enabled like the template expects.

## 0.4.1

### Patch Changes

- 0124380: ### fix(harness): prevent bootstrap hang from npx install prompts

  Add `--yes` to every `npx` call in the harness builder so npx auto-confirms
  package downloads instead of prompting. Under the spinner, stdin is `'ignore'`
  — any prompt would hang indefinitely:
  - `npx --yes @react-native-community/cli init` (scaffold step, runs before the
    project's `node_modules` exist, so npx always needs to resolve the package
    over the network)
  - `npx --yes react-native build-ios` and
    `npx --yes react-native
build-android` (build steps; defensive — these
    usually resolve locally after `bun install`)

  While here, also switch `buildAndroid` from a raw `gradlew
assembleDebug` to
  `npx react-native build-android` for symmetry with iOS and to let the RN CLI
  handle codegen + Gradle wrapper setup. Pass `--tasks assembleDebug`
  explicitly: the CLI defaults its task prefix to `bundle` (producing an
  `.aab`), not `assemble` (producing the `.apk` we need). The `--help` text is
  misleading on this point.

## 0.4.0

### Minor Changes

- be23517: Fix component hot reload during `pause()` and improve build
  robustness.

  **HMR fix:** Editing a component file while paused previously triggered a full
  app reload instead of a live Fast Refresh update. The root cause was twofold:
  1. Components loaded with `__ReactRefresh` disabled had no family
     registrations, so `performReactRefresh()` couldn't map old→new component
     types.
  2. Restoring the real Refresh runtime during pause caused Metro to detect a
     boundary status change ("invalidated boundary") and call
     `performFullRefresh()`.

  The fix installs a registration-only shim that builds component families from
  initial load (forwarding `register()`) while preventing implicit self-accept
  (`isLikelyComponentType()` → false). During pause, `performFullRefresh()` is
  suppressed and `performReactRefresh()` is triggered manually.

  **Build improvements:**
  - Use `npx react-native build-ios` / `build-android` instead of raw
    xcodebuild/gradlew — simplifies the build step and lets RN CLI handle pod
    install, gem setup, and gradle wrapper automatically.
  - Detect and recover from stale build locks (killed/interrupted builds no
    longer block subsequent runs indefinitely).
  - Clean incomplete binaries and DerivedData before rebuilding.
  - Add `--verbose` flag to all CLI commands (streams child-process output
    instead of using a spinner).

### Patch Changes

- 2035ecc: Anchor the generated Metro config's `vitest-stubs/` lookup at the
  active workspace's `node_modules/vitest-mobile/` instead of the cached
  harness's.

  The cached harness's `node_modules/vitest-mobile` is installed via `file:`, so
  npm creates a symlink to whichever workspace first built the cache. Two
  workspaces with the same RN version + native modules + vitest-mobile version
  share a cache key, and the second one would hit Metro errors like

  ```
  Failed to get the SHA-1 for: <other-workspace>/node_modules/vitest-mobile/src/metro/vitest-stubs/empty.js.
    Potential causes:
      1) The file is not watched. Ensure it is under the configured `projectRoot` or `watchFolders`.
  ```

  — because the symlink target lives outside the second workspace's
  `projectRoot` and `watchFolders`, so Metro's file map doesn't track it.

  Resolving the stubs from `projectRoot` instead is safe: `computeCacheKey`
  already includes the vitest-mobile package version, so the workspace's stubs
  are guaranteed to match the harness's on every run. The fix is template-only —
  existing cached harness binaries continue to work unchanged, no rebuild
  required.

  Unblocks running tests from multiple checkouts of the same repo (and fixes CI
  tarball-restore scenarios where the originating workspace isn't present on the
  runner).

- a3eeb10: Default the device picker to an existing simulator/AVD instead of
  "Create new"

  The interactive device picker (used by `bootstrap` and `boot-device`) now
  defaults to an existing device rather than prompting to create a dedicated
  one. On iOS the pre-selected device is the most recently booted simulator,
  matching Expo CLI's heuristic; on Android it's the first available AVD.

  "Create new dedicated simulator/AVD" is still available at the bottom of the
  list for users who want isolation. The non-interactive (CI) fallback is
  unchanged — it still auto-creates a project-scoped device.

  This prevents vitest-mobile from stealing Expo CLI's default simulator:
  previously, creating and booting a `VitestMobile-*` sim made it macOS
  Simulator.app's "most recently used" device, so Expo would target it on the
  next `expo start` → `i` press.

## 0.3.1

### Patch Changes

- 846d725: Pin `install-expo-modules` to `0.14.21` so the Expo autolinking step
  succeeds on Linux runners (Android-only CI).

  `install-expo-modules@0.14.18` (the version currently published behind
  upstream's `latest` tag) ships without the `process.platform === 'darwin'`
  gate around its final `pod install --repo-update` step, so on Linux it crashes
  with `ENOENT spawn pod` and bootstrap aborts before `patchAppDelegateForExpo`
  can run. `0.14.21` (newest stable) has the gate restored. Switch from
  `@latest` to a pinned version so we pick up the fix regardless of which
  `install-expo-modules` version upstream tags as `latest` next.

## 0.3.0

### Minor Changes

- d348a55: The harness builder now auto-wires Expo modules autolinking whenever
  a user declares any `expo-*` (or `expo`, or `@expo/*`) entry in
  `nativePlugin({ harness: { nativeModules } })`. This unblocks testing
  components from libraries that pull Expo modules under the hood — e.g.
  `expo-blur`, `expo-haptics`, `expo-image`, etc.

  Previously the harness was a vanilla React Native template
  (`use_native_modules!` only — no `use_expo_modules!`), so listing `expo-blur`
  in `nativeModules` got the JS dep installed but no native pod, and JS-side
  renders crashed with `Cannot read property 'BlurView' of undefined` because
  `expo-modules-autolinking` had never run.

  The builder now detects Expo-shaped names in `nativeModules` and runs
  `npx install-expo-modules@latest --non-interactive` against the scaffolded
  project to wire up the Podfile (`use_expo_modules!`), `settings.gradle`
  (`useExpoModules()`), `MainApplication`, and `AppDelegate`. Two
  post-processing patches keep the result compatible with vitest-mobile's own
  pipeline:
  1. The CLI integration's bundle-root rename (`index` →
     `.expo/.virtual-metro-entry`) is reverted, because vitest-mobile rewrites
     `/index.bundle` requests onto its prebuilt bundle directly and never
     consults Expo CLI's resolver.
  2. The missing `bindReactNativeFactory(factory)` call is inserted into
     `AppDelegate.swift`. SDK 54+'s `ExpoAppDelegate.recreateRootView` reads its
     own `factory` property and `fatalError`s if it's unset;
     `install-expo-modules`'s Swift transform doesn't add the bind call, but the
     from-scratch Expo bare template does.

  Cache key bumps to `fmt6` so users with v5 binaries that listed Expo modules
  as deps (no autolinking pipeline) get a fresh build the next time they
  bootstrap.

  Heuristic: a `nativeModules` entry triggers the Expo wiring when its name
  matches `expo`, `expo-*`, or `@expo/*`. Modules outside that pattern still go
  through the React Native community CLI's autolinking, which the scaffolded RN
  template already supports.

## 0.2.2

### Patch Changes

- 320c60b: Fix `vitest-mobile bundle` (and any other CLI command that statically
  reads the metro customizer from a vitest config) to look at `metro.customize`
  on the plugin options.

  `readMetroCustomizerFromConfig` was inspecting `stored.metro` as if it were
  the customizer function itself, but `nativePlugin({ metro })` stashes a
  `MetroOptions` object (`{ bundle, customize, babelPlugins }`) on the plugin
  instance — so the customizer was never picked up and the bundle was built with
  only the harness-anchored base resolver. Any user resolver hook (e.g. monorepo
  `#src/*` rewrites or `react-native` condition pinning) silently dropped on the
  floor in pre-built bundles, while the in-process Vitest pool path was
  unaffected because it reads `options.metro.customize` directly.

  While there: collapse the three plugin-options readers
  (`readNativeModulesFromConfig`, `readMetroCustomizerFromConfig`,
  `readBabelPluginsFromConfig`) onto a single typed extractor
  (`readVitestMobilePluginOptions`) that returns `NativePluginOptions[]` for the
  matching projects. Each per-field reader is now a tiny pluck function over the
  shared extractor — so a future change to the plugin-options shape fails the
  type-checker in one place instead of silently dropping options in three. The
  extractor also normalizes the legacy top-level `nativeModules` field into
  `harness.nativeModules` so consumers stay strictly typed.

  Internal: also extract the readers from `cli/index.ts` into a new internal
  `cli/config-readers.ts` module (no public API change) so they can be
  unit-tested without dragging the cac dispatcher in. Adds regression tests
  covering all readers, including the metro-customizer bug fix and the legacy
  `nativeModules` compat path.

## 0.2.1

### Patch Changes

- 66f4239: Add `metro.babelPlugins` option to inject extra Babel plugins into
  Metro's transform pipeline.

  Native modules like `react-native-reanimated` require compile-time Babel
  transforms (e.g. worklet directives) that Metro won't apply unless the plugin
  is explicitly wired in. Previously, users had no way to add these — worklet
  transforms were silently skipped in both watch mode and pre-built bundles.

  **New option: `metro.babelPlugins`.**

  ```ts
  nativePlugin({
    harness: { nativeModules: ['react-native-reanimated'] },
    metro: { babelPlugins: ['react-native-reanimated/plugin'] },
  });
  ```

  Plugins are resolved from the harness project's `node_modules` and injected
  into the generated Metro transformer shim. They run before vitest-mobile's own
  plugins so worklet transforms etc. are applied before the test wrapper
  inspects the output. Works in both live Metro (watch mode) and `bundle`
  pre-builds.

  **Auto-injection for known modules.** When a native module listed in
  `harness.nativeModules` has a well-known companion Babel plugin (currently
  just `react-native-reanimated` → `react-native-reanimated/plugin`), the
  harness builder automatically adds it to `babel.config.js` during `bootstrap`.

  **CLI plumbing.** The `bundle` command now reads `metro.babelPlugins` from the
  vitest config and passes them through to the bundler, so pre-built bundles
  match live-Metro output.

## 0.2.0

### Minor Changes

- fd223b8: Restructure plugin options and rewrite tye device-side runtime.

  ### Breaking: plugin options

  `nativePlugin(...)` options are now nested into `harness` / `device` / `metro`
  groups:

  ```ts
  // Before
  nativePlugin({
    platform: 'ios',
    headless: true,
    bundle: true,
    metro: customizerFn,
  });

  // After
  nativePlugin({
    platform: 'ios',
    device: { headless: true },
    metro: { bundle: true, customize: customizerFn },
  });
  ```

  Removed `promptForNewDevice` and `skipIfUnavailable`. Missing environments now
  throw instead of soft-skipping.

  ### Runtime rewrite
  - `setup.ts`, `ControlBridge`, `TestRegistry`, `TestRunnerService`, `run.ts`,
    `state.ts` collapsed into a single `HarnessRuntime` root that owns
    connection, state, registry diff, and RPC forwarding.
  - Generated test-registry module replaced by `require.context` in
    `test-context.ts` (backed by new `inline-app-root-plugin`).
  - Explorer UI walks Vitest's native task tree directly; old `TestTreeNode`
    parallel tree deleted.
  - `ReactNativeRunner` simplified to `(config, runtime)` — delegates
    `onCollected`/`onTaskUpdate` to the runtime.
  - Task state (`collectedFiles`, `taskState`) lives on the runtime instance;
    entries are append-only across reruns.

  ### Other
  - New `vitest-compat-plugin.ts` rewrites Vitest dist for Hermes/Metro.
    Hermes-safe `node:*` stubs added.
  - Pool-side: `PauseController`, Metro log tailing, bundle server, and pool
    message types extracted into dedicated modules.

- 1434ccd: Per-project device ownership, interactive device picker, and a big
  CLI UX polish pass.

  **Project-scoped devices (iOS + Android).**
  - Each project now owns a specific simulator / AVD, stored in
    `~/.cache/vitest-mobile/devices.json` keyed by project path. Running Expo,
    Android Studio, or another vitest-mobile project on the same machine no
    longer collides with your tests.
  - `vitest-mobile bootstrap` always shows an interactive picker: your existing
    simulators/AVDs plus a "Create new dedicated device" option. Current mapping
    is pre-selected so hitting Enter keeps your choice.
  - `--device <name>` skips the picker (for CI and scripts). Non-TTY bootstrap
    auto-creates the project-scoped device.
  - On Android, "Create new" is annotated as unavailable and refused unless the
    Android cmdline-tools (`sdkmanager` + `avdmanager`) are installed — with a
    pointer to install them or pick an existing AVD instead.
  - `reset-device` now respects whether vitest-mobile created the device:
    deletes + clears the mapping if we created it, only clears the mapping if
    the user picked their own device.
  - iOS: existing `VitestMobile-<hash>` simulators are auto-registered into the
    mapping on first run (no re-prompt on upgrade).
  - Concurrent runs on the same project get a per-instance secondary simulator
    (iOS) / emulator instance (Android).

  **CLI UX polish.**
  - **Consistent `--platform` flag (breaking).** Every command takes
    `--platform <ios|android>` (previously some were positional, some
    `--platform`). The old `vitest-mobile build ios` form prints a clear
    migration hint and exits non-zero. Most commands prompt (TTY) or error
    (non-TTY) when `--platform` is omitted; `trim-cache` / `clean-devices` /
    `bundle` default to both platforms; `cache-key` still requires an explicit
    platform.
  - **Spinners with live step messages** for `build`, `install`, `bootstrap`,
    `bundle`, `boot-device` — instead of a wall of xcodebuild / gradle /
    pod-install output. Spinner now animates during long builds (the underlying
    spawn is async; previously a sync `execSync` blocked the event loop).
  - **Child-process output is tee'd to
    `~/.cache/vitest-mobile/logs/<timestamp>-<command>-<platform>.log`.** On
    failure the log path is printed; nothing is silently swallowed.
  - **Ctrl+C now works during long builds** (same async-spawn fix — SIGINT
    previously went to the blocked child instead of Node).
  - **Unknown commands exit 1** with a help dump (previously exited 0 silently).

  **Metro + native modules config.**
  - New `nativePlugin({ metro })` customizer and exported
    `MetroConfigCustomizer` type. Layers on top of the auto-generated
    harness-anchored base Metro config (runs before internal test transforms, so
    the vitest shim and test-registry stay authoritative). Composes across
    multiple plugin instances.
  - `build`, `install`, `bootstrap`, and `bundle` CLIs read `nativeModules` from
    the vitest config automatically; `--native-modules` overrides when passed.

  **Setup diagnostics.**
  - Simulator creation failures now report the real cause — unaccepted Xcode
    license, `xcode-select` pointing at Command Line Tools, missing iOS runtime.
    Preflight checks before `xcodebuild` catch SDK/runtime mismatch upfront.

  **Build system.**
  - Xcode 26.4 compat: bundled `fmt` pod pinned to C++17 so RCT-Folly compiles
    under Apple Clang 21. Harness build format bumped to v5 — existing cached
    binaries rebuild once.

  **Fixes.**
  - `promptConfirm` no longer leaks a stdin resume that kept `bootstrap` alive
    after accepting the prompt.

### Patch Changes

- 01ce6fe: Collapse the pool worker lifecycle to fire once per user-initiated
  run instead of once per file, by setting `test.isolate = false` in the
  plugin's config hook.

  **Why.** With `isolate: true` (the previous default), Vitest's scheduler
  created one `PoolRunner` per test file, meaning `worker.start()` and
  `worker.stop()` — and the 60s / 90s handshake timeouts guarding them — fired N
  times per run. The React Native harness shares a single JS VM across files
  anyway, so the per-file isolation was a fiction maintained by singleton
  idempotency flags. Under `isolate: false` + `maxWorkers: 1`, Vitest bundles
  every file into one task with `context.files = [all]`, and the handshake
  timers fire exactly once per user-initiated run (initial or HMR-driven rerun).
  Timer scope now matches reality.

  **Changes.**
  - `test.isolate = false` is applied by the plugin, guarded so user-level
    overrides win.
  - `canReuse: () => true` added to the pool worker.
  - Device-side `handleRun` refactored into a per-file loop so explorer
    file-start/file-done UI events still fire per file; test execution inside
    `startTests` is unchanged.
  - Removed dead code: the fallback `__rerun` replay path (Vitest ^4's
    `rerunFiles` is guaranteed), the `_lastRunMessages` map, `_sessionCount`,
    `countTestsInSpecs`, and the triple-keying of file identifiers. Reporter
    shrunk to a pass-through for `__native_run_start` / `__native_run_end` plus
    the `run`-mode `teardown()` await.

  No user-visible behavior change. Custom Vitest pools, test configs that
  explicitly set `test.isolate`, and the device-side test execution path are all
  unaffected.

## 0.1.1

### Patch Changes

- 5c06893: Includes missing files in publish

## 0.1.0

### Minor Changes

- 62f1809: Initial Release
- 759910b: Initial release of vitest-mobile
