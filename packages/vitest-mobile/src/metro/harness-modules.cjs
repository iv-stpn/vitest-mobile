// Single source of truth for the module-resolution allow-lists shared by BOTH
// the generated Metro config (assets/templates/node/metro.config.cjs) and
// applyTestTransforms (src/node/metro-runner.ts). Loaded at runtime from the
// consumer's installed vitest-mobile in both contexts, so the two resolver
// paths can never drift. CommonJS so the generated `.cjs` config can `require`
// it directly.
'use strict';

// Node built-ins + Vite/Vitest internals that `vitest/worker` statically
// imports but that don't exist on Hermes. Each maps to a dedicated on-disk stub
// under vitest-stubs/ (e.g. `node:path` → pathe) or falls back to `empty.js`.
const STUBBED_MODULES = [
  // Node built-ins
  'node:module',
  'node:url',
  'node:path',
  'node:fs',
  'node:fs/promises',
  'node:vm',
  'node:async_hooks',
  'node:perf_hooks',
  'node:timers',
  'node:timers/promises',
  'node:util',
  'node:assert',
  'node:v8',
  'node:console',
  'node:process',
  'node:stream',
  'node:events',
  'node:buffer',
  'node:worker_threads',
  // Vite internals
  'vite/module-runner',
  // Optional Vitest environment packages — dynamically imported but never
  // reached on device.
  '@edge-runtime/vm',
  'happy-dom',
  'jsdom',
  // OpenTelemetry API — gated behind traces.enabled (false), but the
  // `import('@opentelemetry/api')` literal makes Metro resolve it at bundle time.
  '@opentelemetry/api',
];

// Packages pinned to the harness tree so the bundle uses the exact copies the
// prebuilt harness binary was compiled against (avoids duplicate-module/identity
// mismatches in a monorepo). Matches by exact name, `pkg/...` subpath, or the
// `@react-native/*` scope.
const HARNESS_PINNED = [
  'react',
  'react-native',
  'react-native-safe-area-context',
  // Babel runtime helpers — injected by the transformer into every transformed file.
  '@babel/runtime',
  // vitest-mobile runtime deps — only installed in the harness tree (via vitest/chai/etc.),
  // not in the user's workspace root.
  'chai',
  'flatted',
  'pathe',
  'signalium',
  '@shopify/restyle',
  '@vitest/expect',
  '@vitest/runner',
  '@vitest/utils',
];

function isHarnessPinned(name) {
  if (HARNESS_PINNED.includes(name)) return true;
  for (const pkg of HARNESS_PINNED) {
    if (name === pkg || name.startsWith(`${pkg}/`)) return true;
  }
  return name.startsWith('@react-native/');
}

module.exports = { STUBBED_MODULES, HARNESS_PINNED, isHarnessPinned };
