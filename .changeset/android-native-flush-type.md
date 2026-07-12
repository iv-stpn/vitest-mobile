---
"@iv-stpn/vitest-mobile": patch
---

fix(android): triple-post `flushUIQueue` avoids headless Choreographer deadlock; `typeIntoView` sets text directly

**`flushUIQueue`** — The previous `Choreographer.postFrameCallback` implementation waited for the next VSYNC frame. In headless mode (`-no-window`) the virtual display does not fire VSYNC while the UI is idle, so the callback never fired and any test that called `render()` or `cleanup()` deadlocked. Replaced with a triple `mainHandler.post` (mirrors iOS's triple `dispatch_async` pattern) that drains pending UI work without depending on VSYNC. A synchronous `measure()+layout()` pass is also driven here to ensure views have correct frames for coordinate queries.

**`typeIntoView`** — The previous implementation dispatched synthesized `DOWN`/`UP` `MotionEvent`s to focus the target `EditText`, then replaced `currentFocus.text`. On Android headless the synthetic focus rarely worked, leaving `currentFocus` null and silently dropping the text. Replaced with `view.requestFocus()` + `view.text.replace()` directly on the target view resolved by `nativeId`. Mutating the `Editable` fires React Native's `TextWatcher` → `onChangeText`, so controlled components update correctly.
