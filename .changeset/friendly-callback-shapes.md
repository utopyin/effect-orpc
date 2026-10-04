---
"effect-orpc": minor
---

Support Effect-returning callbacks everywhere Effect-native callbacks are accepted.

Handlers, request-scoped providers, optional providers, `.use(...)`, and reusable `.middleware(...)` now accept `Effect.fn(...)` and functions returning `Effect.gen(...)` in addition to existing generator callbacks. Native oRPC middleware behavior is preserved, including `return next(...)` and guard-only middleware.

Named user spans from `Effect.fn("name")` and `Effect.withSpan(...)` are preserved inside the automatic procedure span.
