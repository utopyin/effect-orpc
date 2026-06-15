# effect-orpc

## 0.4.0

### Minor Changes

- 070f9aa: Add `eos`, the default Effect-aware builder for the `eos.provide(AppLive)` workflow. `ManagedRuntime` is now used only when you pass one explicitly, so applications can use Layer-provided builders by default and opt into a user-owned runtime when they need to control Layer acquisition and release from their application lifecycle.

## 0.3.0

### Minor Changes

- 44e7b5e: Add Layer-based service provisioning: `makeEffectORPC(...)` and `implementEffect(...)` now accept a `Layer` in addition to `ManagedRuntime`. Builders can also start without a runtime and add base services later with `.provide(layer)`.

  Add request-scoped Effect providers with `.provide(tag, provider)` and `.provideOptional(...)`, allowing procedures and downstream Effect middleware/handlers to access services derived from the current request context.

  Add Effect-native generator middleware support to `.use(function* ...)`, including access to Effect services, Effect errors, `next(...)`, and `output(...)` from inside middleware.

  Add reusable Effect-native middleware support to `builder.middleware(function* ...)`, so generator middleware can be defined once, use provided Effect services, and be passed to `.use(...)`.

  Add contiguous Effect pipeline execution: adjacent Effect-native `.provide*`, generator `.use(...)`, and `.effect(...)` steps now run inside a single runtime boundary instead of crossing the runtime for each step, while preserving ordering around native oRPC middleware.

  Extend the existing Node FiberRef bridge to preserve FiberRefs across split Effect groups, including side-effect-only `effect-orpc/node` bridge installation.

## 0.2.2

### Patch Changes

- 1e2d2c7: Add JSDocs back

## 0.2.1

### Patch Changes

- 21b9c8a: Improve Effect builder and procedure compatibility with upstream oRPC by proxying the upstream builder/procedure surfaces while preserving Effect runtime, error map, and tracing metadata.

## 0.2.0

### Minor Changes

- ce9f590: Add `eoc`, an Effect-aware wrapper around `@orpc/contract`'s `oc`, so contract definitions can reuse tagged error classes directly in `.errors(...)`.

  Example:

  ```ts
  class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
    code: "NOT_FOUND",
    schema: z.object({ userId: z.string() }),
  }) {}

  const contract = {
    users: {
      find: eoc
        .errors({
          NOT_FOUND: UserNotFoundError,
        })
        .input(z.object({ userId: z.string() }))
        .output(z.object({ userId: z.string() })),
    },
  };
  ```

- 5e42e78: Add `implementEffect(contract, runtime)` for contract-first oRPC handlers backed by Effect, including contract leaf `.effect(...)` support and root router enhancement.

  Example:

  ```ts
  const oe = implementEffect(contract, runtime);

  export const router = oe.router({
    users: {
      list: oe.users.list.effect(function* ({ input }) {
        return yield* UsersRepo.list(input.amount);
      }),
    },
  });
  ```

### Patch Changes

- 926dbf4: Document the new contract-first APIs with examples for `eoc` and `implementEffect`.
- 6937a19: Restore wrapped oRPC builder and implementer parity by aligning `.middleware(...)`, `.handler(...)`, and related variant typings with upstream behavior.
- 92ca0eb: Add parity regression coverage for wrapped oRPC contract builders, Effect builders, and contract implementers.

## 0.1.4

### Patch Changes

- b1d95d7: Add README

## 0.1.3

### Patch Changes

- ed5bc70: Sync readme from root to package so that it gets published on NPM

## 0.1.2

### Patch Changes

- 4dcdec0: Symlinked README.md to root's README
- e802e5e: fix: Preserve runtime services when inheriting request fiber refs with `withFiberContext`.

## 0.1.1

### Patch Changes

- 16a7fe8: Add documentation on new `withFiberContext`

## 0.1.0

### Minor Changes

- d213c5b: Add `withFiberContext` helper at `effect-orpc/node` to
  propagate Effect `FiberRef` state across framework async boundaries, and add a
  workspace Hono example showing request-scoped log and trace propagation.

### Patch Changes

- 0c81aec: Fix `.output()` typing enforcement in the Effect builder.
