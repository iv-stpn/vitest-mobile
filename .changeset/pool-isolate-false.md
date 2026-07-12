---
"@iv-stpn/vitest-mobile": patch
---

fix(pool): force `isolate: false` to prevent per-file worker teardown

Vitest defaults `cfg.isolate` to `true`. The previous guard
(`if (cfg.isolate === undefined)`) never fired because Vitest had already set
the field, causing each test file to get its own worker cycle:
`run(file) → worker.stop() → run(next file)`. `worker.stop()` tears down Metro
and terminates the device WebSocket, so every file after the first arrived with
no connection and the run stopped early — **only 1 of 4 test files ran**.

The native pool requires `isolate: false` — there is a single RN JS VM per
platform that persists across all files. The fix forces `cfg.isolate = false`
unconditionally and emits a warning if the user had explicitly set it to `true`.
