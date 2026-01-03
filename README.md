# effect-orpc

A type-safe integration between [oRPC](https://orpc.dev/) and [Effect](https://effect.website/), enabling Effect-native procedures with full service injection support, OpenTelemetry tracing support and typesafe Effect errors support.

Inspired by [effect-trpc](https://github.com/mikearnaldi/effect-trpc).

## Features

- **Effect-native procedures** - Write oRPC procedures using generators with `yield*` syntax
- **Type-safe service injection** - Use `ManagedRuntime<R>` to provide services to procedures with compile-time safety
- **Tagged errors** - Create Effect-native error classes with `ORPCTaggedError` that integrate with oRPC's error handling
- **Full oRPC compatibility** - Mix Effect procedures with standard oRPC procedures in the same router
- **Telemetry support with automatic tracing** - Procedures are automatically traced with OpenTelemetry-compatible spans. Customize span names with `.traced()`.
- **Builder pattern preserved** - oRPC builder methods (`.errors()`, `.meta()`, `.route()`, `.input()`, `.output()`, `.use()`) work seamlessly

## Installation

```bash
npm install effect-orpc
# or
pnpm add effect-orpc
# or
bun add effect-orpc
```

## Demo of the features

```ts
import { os } from "@orpc/server";
import { Effect, ManagedRuntime } from "effect";
import { makeEffectORPC, ORPCTaggedError } from "effect-orpc";

interface User {
  id: number;
  name: string;
}

let users: User[] = [
  { id: 1, name: "John Doe" },
  { id: 2, name: "Jane Doe" },
  { id: 3, name: "James Dane" },
];

// Authenticated os with initial context & errors set
const authedOs = os
  .errors({ UNAUTHORIZED: { status: 401 } })
  .$context<{ userId?: number }>()
  .use(({ context, errors, next }) => {
    if (context.userId === undefined) throw errors.UNAUTHORIZED();
    return next({ context: { ...context, userId: context.userId } });
  });

// Define your services
class UsersRepo extends Effect.Service<UsersRepo>()("UserService", {
  accessors: true,
  sync: () => ({
    get: (id: number) => users.find((u) => u.id === id),
  }),
}) {}

// Special yieldable oRPC error class
class UserNotFoundError extends ORPCTaggedError()("UserNotFoundError", {
  status: 404,
}) {}

// Create runtime with your services
const runtime = ManagedRuntime.make(UsersRepo.Default);
// Create Effect-aware oRPC builder from an other (optional) base oRPC builder
const effectOs = makeEffectORPC(runtime, authedOs).errors({
  UserNotFoundError,
});

// Create the router with mixed procedures
export const router = {
  health: os.handler(() => "ok"),
  users: {
    me: effectOs.effect(function* ({ context: { userId } }) {
      const user = yield* UsersRepo.get(userId);
      if (!user) {
        return yield* new UserNotFoundError();
      }
      return user;
    }),
  },
};

export type Router = typeof router;
```

## Type Safety

The wrapper enforces that Effect procedures only use services provided by the `ManagedRuntime`. If you try to use a service that isn't in the runtime, you'll get a compile-time error:

```ts
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { makeEffectORPC } from "effect-orpc";

class ProvidedService extends Context.Tag("ProvidedService")<
  ProvidedService,
  { doSomething: () => Effect.Effect<string> }
>() {}

class MissingService extends Context.Tag("MissingService")<
  MissingService,
  { doSomething: () => Effect.Effect<string> }
>() {}

const runtime = ManagedRuntime.make(
  Layer.succeed(ProvidedService, {
    doSomething: () => Effect.succeed("ok"),
  }),
);

const effectOs = makeEffectORPC(runtime);

// ✅ This compiles - ProvidedService is in the runtime
const works = effectOs.effect(function* () {
  const service = yield* ProvidedService;
  return yield* service.doSomething();
});

// ❌ This fails to compile - MissingService is not in the runtime
const fails = effectOs.effect(function* () {
  const service = yield* MissingService; // Type error!
  return yield* service.doSomething();
});
```

## Error Handling

`ORPCTaggedError` lets you create Effect-native error classes that integrate seamlessly with oRPC. These errors:

- Can be yielded in Effect generators (`yield* new MyError()` or `yield* Effect.fail(errors.MyError)`)
- Can be used in Effect builder's `.errors()` maps for type-safe error handling alongside regular oRPC errors
- Automatically convert to ORPCError when thrown

Make sure the tagged error class is passed to the effect `.errors()` to be able to yield the error class directly and make the client recognize it as defined.

```ts
const getUser = effectOs
  // Mixed error maps
  .errors({
    // Regular oRPC error
    NOT_FOUND: {
      message: "User not found",
      data: z.object({ id: z.string() }),
    },
    // Effect oRPC tagged error
    UserNotFoundError,
    // Note: The key of an oRPC error is not used as the error code
    // So the following will only change the key of the error when accessing it
    // from the errors object passed to the handler, but not the actual error code itself.
    // To change the error's code, please see the next section on creating tagged errors.
    USER_NOT_FOUND: UserNotFoundError,
    // ^^^ same code as the `UserNotFoundError` error key, defined at the class level
  })
  .effect(function* ({ input, errors }) {
    const user = yield* UsersRepo.findById(input.id);
    if (!user) {
      return yield* new UserNotFoundError();
      // or return `yield* Effect.fail(errors.USER_NOT_FOUND())`
    }
    return user;
  });
```

### Creating Tagged Errors

```ts
import { ORPCTaggedError } from "effect-orpc";

// Basic tagged error - code defaults to 'USER_NOT_FOUND' (CONSTANT_CASE of tag)
class UserNotFound extends ORPCTaggedError()("UserNotFound") {}

// With explicit code
class NotFound extends ORPCTaggedError()("NotFound", "NOT_FOUND") {}

// With default options (code defaults to 'VALIDATION_ERROR') (CONSTANT_CASE of tag)
class ValidationError extends ORPCTaggedError()("ValidationError", {
  status: 400,
  message: "Validation failed",
}) {}

// With explicit code and options
class Forbidden extends ORPCTaggedError()("Forbidden", "FORBIDDEN", {
  status: 403,
  message: "Access denied",
}) {}

// With typed data using Standard Schema
class UserNotFoundWithData extends ORPCTaggedError(
  z.object({ userId: z.string() }),
)("UserNotFoundWithData") {}
```

## Traceable Spans

All Effect procedures are automatically traced with `Effect.withSpan`. By default, the span name is the procedure path (e.g., `users.getUser`):

```ts
// Router structure determines span names automatically
const router = {
  users: {
    // Span name: "users.get"
    get: effectOs.input(z.object({ id: z.string() })).effect(function* ({
      input,
    }) {
      const userService = yield* UserService;
      return yield* userService.findById(input.id);
    }),
    // Span name: "users.create"
    create: effectOs.input(z.object({ name: z.string() })).effect(function* ({
      input,
    }) {
      const userService = yield* UserService;
      return yield* userService.create(input.name);
    }),
  },
};
```

Use `.traced()` to override the default span name:

```ts
const getUser = effectOs
  .input(z.object({ id: z.string() }))
  .traced("custom.span.name") // Override the default path-based name
  .effect(function* ({ input }) {
    const userService = yield* UserService;
    return yield* userService.findById(input.id);
  });
```

### Enabling OpenTelemetry

To enable tracing, include the OpenTelemetry layer in your runtime:

```ts
import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

const TracingLive = NodeSdk.layer(
  Effect.sync(() => ({
    resource: { serviceName: "my-service" },
    spanProcessor: [new SimpleSpanProcessor(new OTLPTraceExporter())],
  })),
);

const AppLive = Layer.mergeAll(UserServiceLive, TracingLive);

const runtime = ManagedRuntime.make(AppLive);
const effectOs = makeEffectORPC(runtime);
```

### Error Stack Traces

When an Effect procedure fails, the span includes a properly formatted stack trace pointing to the definition site:

```
MyCustomError: Something went wrong
    at <anonymous> (/app/src/procedures.ts:42:28)
    at users.getById (/app/src/procedures.ts:41:35)
```

## API Reference

### `makeEffectORPC(runtime, builder?)`

Creates an Effect-aware procedure builder.

- `runtime` - A `ManagedRuntime<R, E>` instance that provides services for Effect procedures
- `builder` (optional) - An oRPC Builder instance to wrap. Defaults to `os` from `@orpc/server`

Returns an `EffectBuilder` instance.

```ts
// With default builder
const effectOs = makeEffectORPC(runtime);

// With customized builder
const effectAuthedOs = makeEffectORPC(runtime, authedBuilder);
```

### `EffectBuilder`

Wraps an oRPC Builder with Effect support. Available methods:

| Method              | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `.$config(config)`  | Set or override the builder config                                              |
| `.$context<U>()`    | Set or override the initial context type                                        |
| `.$meta(meta)`      | Set or override the initial metadata                                            |
| `.$route(route)`    | Set or override the initial route configuration                                 |
| `.$input(schema)`   | Set or override the initial input schema                                        |
| `.errors(map)`      | Add type-safe custom errors                                                     |
| `.meta(meta)`       | Set procedure metadata (merged with existing)                                   |
| `.route(route)`     | Configure OpenAPI route (merged with existing)                                  |
| `.input(schema)`    | Define input validation schema                                                  |
| `.output(schema)`   | Define output validation schema                                                 |
| `.use(middleware)`  | Add middleware                                                                  |
| `.traced(name)`     | Add a traceable span for telemetry (optional, defaults to the procedure's path) |
| `.handler(handler)` | Define a non-Effect handler (standard oRPC handler)                             |
| `.effect(handler)`  | Define the Effect handler                                                       |
| `.prefix(prefix)`   | Prefix all procedures in the router (for OpenAPI)                               |
| `.tag(...tags)`     | Add tags to all procedures in the router (for OpenAPI)                          |
| `.router(router)`   | Apply all options to a router                                                   |
| `.lazy(loader)`     | Create and apply options to a lazy-loaded router                                |

### `EffectDecoratedProcedure`

The result of calling `.effect()`. Extends standard oRPC `DecoratedProcedure` with Effect type preservation.

| Method                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `.errors(map)`          | Add more custom errors                        |
| `.meta(meta)`           | Update metadata (merged with existing)        |
| `.route(route)`         | Update route configuration (merged)           |
| `.use(middleware)`      | Add middleware                                |
| `.callable(options?)`   | Make procedure directly invocable             |
| `.actionable(options?)` | Make procedure compatible with server actions |

### `ORPCTaggedError(schema?)(tag, codeOrOptions?, defaultOptions?)`

Factory function to create Effect-native tagged error classes.
If no code is provided, it defaults to CONSTANT_CASE of the tag (e.g., `UserNotFoundError` → `USER_NOT_FOUND_ERROR`).

- `schema` - Optional Standard Schema for the error's data payload (e.g., `z.object({ userId: z.string() })`)
- `tag` - Unique tag for discriminated unions (used by Effect's `catchTag`)
- `codeOrOptions` - Either an ORPCErrorCode string or `{ status?, message? }` options
- `defaultOptions` - Default `{ status?, message? }` when code is provided explicitly

## License

MIT
