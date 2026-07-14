---
'@iv-stpn/vitest-mobile': patch
---

fix(runtime): `waitFor`/`poll` no longer throw a bare `undefined` on a zero or already-elapsed timeout

Both retry helpers checked the deadline (`Date.now() < deadline`) *before* the first attempt. With `timeout: 0`, a negative timeout, or a clock that advanced past the deadline before the loop started, the body never ran and the function executed `throw lastError` while `lastError` was still `undefined` — surfacing an undebuggable `undefined` instead of the real assertion failure or a timeout message.

Both functions now use a `do/while` so `fn` is always attempted at least once, and fall back to a descriptive `Error` (`"waitFor timed out after Nms without an attempt succeeding"`) when a timeout elapses without any attempt having thrown. Regression tests cover the zero- and negative-timeout paths for both helpers.
