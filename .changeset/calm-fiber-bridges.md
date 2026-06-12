---
"effect-orpc": minor
---

Add Layer-based service provisioning: `makeEffectORPC(...)` and `implementEffect(...)` now accept a `Layer` in addition to `ManagedRuntime`. Builders can also start without a runtime and add base services later with `.provide(layer)`.

Add request-scoped Effect providers with `.provide(tag, provider)` and `.provideOptional(...)`, allowing procedures and downstream Effect middleware/handlers to access services derived from the current request context.

Add Effect-native generator middleware support to `.use(function* ...)`, including access to Effect services, Effect errors, `next(...)`, and `output(...)` from inside middleware.

Add reusable Effect-native middleware support to `builder.middleware(function* ...)`, so generator middleware can be defined once, use provided Effect services, and be passed to `.use(...)`.

Add contiguous Effect pipeline execution: adjacent Effect-native `.provide*`, generator `.use(...)`, and `.effect(...)` steps now run inside a single runtime boundary instead of crossing the runtime for each step, while preserving ordering around native oRPC middleware.

Extend the existing Node FiberRef bridge to preserve FiberRefs across split Effect groups, including side-effect-only `effect-orpc/node` bridge installation.
