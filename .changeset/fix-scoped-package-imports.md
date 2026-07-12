---
"@iv-stpn/vitest-mobile": patch
---

Fix all internal imports to use the scoped package name `@iv-stpn/vitest-mobile` instead of the bare `vitest-mobile` specifier, which was unresolvable at bundle and config load time.
