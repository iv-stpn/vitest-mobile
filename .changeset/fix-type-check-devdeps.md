---
"@iv-stpn/vitest-mobile": patch
---

fix(types): add missing type devDependencies and fix implicit any errors

Add `@babel/core`, `@babel/types`, `@types/babel__core`, `@types/chai`,
`metro`, `metro-config`, and `metro-resolver` as devDependencies so
`tsc --noEmit` can resolve all type declarations.

Fix two implicit `any` errors in `metro-runner.ts`:
- Use `NonNullable<EnhanceMiddleware>` so TypeScript can contextually type
  the `middleware` / `metroServer` parameters (the `| undefined` union
  blocked inference).
- Remove stale object destructuring from `metro.runServer()` — metro 0.81
  returns `HttpServer | HttpsServer` directly, not `{ httpServer }`.
