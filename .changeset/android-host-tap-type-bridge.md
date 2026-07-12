---
"@iv-stpn/vitest-mobile": minor
---

feat(runtime): host-side `adb shell input` bridge for reliable Android headless tap and type

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
