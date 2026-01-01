# effect-orpc

A type-safe integration between [oRPC](https://orpc.dev/) and [Effect](https://effect.website/), enabling Effect-native procedures with full service injection support.

Inspired by [effect-trpc](https://github.com/mikearnaldi/effect-trpc).

## Features

- **Effect-native procedures** - Write oRPC procedures using generators with `yield*` syntax
- **Type-safe service injection** - Use `ManagedRuntime<R>` to provide services to procedures with compile-time safety
- **Full oRPC compatibility** - Mix Effect procedures with standard oRPC procedures in the same router
- **Builder pattern preserved** - All oRPC builder methods (`.errors()`, `.meta()`, `.route()`, `.input()`, `.output()`, `.use()`) work seamlessly
- **Callable procedures** - Make procedures directly invocable while preserving Effect types
- **Server actions support** - Full compatibility with framework server actions

## Installation

```bash
npm install effect-orpc
# or
pnpm add effect-orpc
# or
bun add effect-orpc
```

## Quick Start

```ts
import { makeEffectORPC } from 'effect-orpc'
import { os } from '@orpc/server'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { z } from 'zod'

// Define your services
class UserService extends Context.Tag('UserService')<
  UserService,
  {
    findById: (id: string) => Effect.Effect<User | undefined>
    findAll: () => Effect.Effect<User[]>
    create: (name: string) => Effect.Effect<User>
  }
>() {}

// Create service implementation
const UserServiceLive = Layer.succeed(UserService, {
  findById: id => Effect.succeed(users.find(u => u.id === id)),
  findAll: () => Effect.succeed(users),
  create: name => Effect.succeed({ id: crypto.randomUUID(), name })
})

// Create runtime with your services
const runtime = ManagedRuntime.make(UserServiceLive)

// Create Effect-aware oRPC builder
const effectOs = makeEffectORPC(runtime)

// Define your procedures
const getUser = effectOs
  .input(z.object({ id: z.string() }))
  .effect(
    Effect.fn(function* ({ input }) {
      const userService = yield* UserService
      return yield* userService.findById(input.id)
    })
  )

const listUsers = effectOs
  .effect(
    Effect.fn(function* () {
      const userService = yield* UserService
      return yield* userService.findAll()
    })
  )

const createUser = effectOs
  .input(z.object({ name: z.string() }))
  .effect(
    Effect.fn(function* ({ input }) {
      const userService = yield* UserService
      return yield* userService.create(input.name)
    })
  )

// Create router with mixed procedures
const router = os.router({
  // Standard oRPC procedure
  health: os.handler(() => 'ok'),

  // Effect procedures
  users: os.router({
    get: getUser,
    list: listUsers,
    create: createUser,
  })
})

export type Router = typeof router
```

## Type Safety

The wrapper enforces that Effect procedures only use services provided by the `ManagedRuntime`. If you try to use a service that isn't in the runtime, you'll get a compile-time error:

```ts
class ProvidedService extends Context.Tag('ProvidedService')<
  ProvidedService,
  { doSomething: () => Effect.Effect<string> }
>() {}

class MissingService extends Context.Tag('MissingService')<
  MissingService,
  { doSomething: () => Effect.Effect<string> }
>() {}

const runtime = ManagedRuntime.make(Layer.succeed(ProvidedService, {
  doSomething: () => Effect.succeed('ok')
}))

const effectOs = makeEffectORPC(runtime)

// ✅ This compiles - ProvidedService is in the runtime
const works = effectOs
  .effect(
    Effect.fn(function* () {
      const svc = yield* ProvidedService
      return yield* svc.doSomething()
    })
  )

// ❌ This fails to compile - MissingService is not in the runtime
const fails = effectOs
  .effect(
    Effect.fn(function* () {
      const svc = yield* MissingService // Type error!
      return yield* svc.doSomething()
    })
  )
```

## Using Services

```ts
import { makeEffectORPC } from 'effect-orpc'
import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { z } from 'zod'

// Define services
class DatabaseService extends Context.Tag('DatabaseService')<
  DatabaseService,
  {
    query: <T>(sql: string) => Effect.Effect<T[]>
    execute: (sql: string) => Effect.Effect<void>
  }
>() {}

class CacheService extends Context.Tag('CacheService')<
  CacheService,
  {
    get: <T>(key: string) => Effect.Effect<T | undefined>
    set: <T>(key: string, value: T, ttl?: number) => Effect.Effect<void>
  }
>() {}

// Create layers
const DatabaseServiceLive = Layer.succeed(DatabaseService, {
  query: sql => Effect.succeed([]),
  execute: sql => Effect.succeed(undefined),
})

const CacheServiceLive = Layer.succeed(CacheService, {
  get: key => Effect.succeed(undefined),
  set: (key, value, ttl) => Effect.succeed(undefined),
})

// Compose layers
const AppLive = Layer.mergeAll(DatabaseServiceLive, CacheServiceLive)

// Create runtime with all services
const runtime = ManagedRuntime.make(AppLive)
const effectOs = makeEffectORPC(runtime)

// Use multiple services in a procedure
const getUserWithCache = effectOs
  .input(z.object({ id: z.string() }))
  .effect(
    Effect.fn(function* ({ input }) {
      const cache = yield* CacheService
      const db = yield* DatabaseService

      // Try cache first
      const cached = yield* cache.get<User>(`user:${input.id}`)
      if (cached)
        return cached

      // Fall back to database
      const [user] = yield* db.query<User>(`SELECT * FROM users WHERE id = '${input.id}'`)
      if (user) {
        yield* cache.set(`user:${input.id}`, user, 3600)
      }
      return user
    })
  )
```

## Wrapping a Customized Builder

You can pass a customized oRPC builder as the second argument to inherit middleware, errors, and configuration:

```ts
import { makeEffectORPC } from 'effect-orpc'
import { ORPCError, os } from '@orpc/server'
import { Effect } from 'effect'

// Create a customized base builder with auth middleware
const authedOs = os
  .errors({
    UNAUTHORIZED: { message: 'Not authenticated' },
    FORBIDDEN: { message: 'Access denied' },
  })
  .use(async ({ context, next, errors }) => {
    if (!context.user) {
      throw errors.UNAUTHORIZED()
    }
    return next({ context: { ...context, userId: context.user.id } })
  })

// Wrap the customized builder with Effect support
const effectAuthedOs = makeEffectORPC(runtime, authedOs)

// All procedures inherit the auth middleware and error definitions
const getProfile = effectAuthedOs
  .effect(
    Effect.fn(function* ({ context }) {
      const userService = yield* UserService
      return yield* userService.findById(context.userId)
    })
  )

const updateProfile = effectAuthedOs
  .input(z.object({ name: z.string() }))
  .effect(
    Effect.fn(function* ({ context, input }) {
      const userService = yield* UserService
      return yield* userService.update(context.userId, input)
    })
  )
```

## Chaining Builder Methods

The `EffectBuilder` supports all standard oRPC builder methods:

```ts
const createPost = effectOs
  // Add custom errors
  .errors({
    NOT_FOUND: { message: 'User not found' },
    VALIDATION_ERROR: {
      message: 'Invalid input',
      data: z.object({ field: z.string(), issue: z.string() })
    },
  })
  // Add metadata
  .meta({ auth: true, rateLimit: 100 })
  // Configure route for OpenAPI
  .route({ method: 'POST', path: '/posts', tags: ['posts'] })
  // Define input schema
  .input(z.object({
    title: z.string().min(1).max(200),
    content: z.string(),
    authorId: z.string(),
  }))
  // Define output schema
  .output(z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    createdAt: z.date(),
  }))
  // Define Effect handler
  .effect(({ input, errors }) =>
    Effect.gen(function* () {
      const userService = yield* UserService
      const user = yield* userService.findById(input.authorId)

      if (!user) {
        throw errors.NOT_FOUND()
      }

      const postService = yield* PostService
      return yield* postService.create({
        title: input.title,
        content: input.content,
        authorId: input.authorId,
      })
    })
  )
```

## Making Procedures Callable

Use `.callable()` to make procedures directly invocable:

```ts
const greet = effectOs
  .input(z.object({ name: z.string() }))
  .effect(({ input }) => Effect.succeed(`Hello, ${input.name}!`))
  .callable()

// Can be called directly as a function
const result = await greet({ name: 'World' })
// => "Hello, World!"

// Still a valid procedure for routers
const router = os.router({ greet })
```

## Server Actions Support

Use `.actionable()` for framework server actions (Next.js, etc.):

```tsx
const createTodo = effectOs
  .input(z.object({ title: z.string() }))
  .effect(
    Effect.fn(function* ({ input }) {
      const todoService = yield* TodoService
      return yield* todoService.create(input.title)
    })
  )
  .actionable({ context: async () => ({ user: await getSession() }) })

// Use in React Server Components
export async function TodoForm() {
  return (
    <form action={createTodo}>
      <input name="title" />
      <button type="submit">Add Todo</button>
    </form>
  )
}
```

## Error Handling

Effect errors are properly propagated through oRPC's error handling:

```ts
import { Effect } from 'effect'

class NotFoundError extends Effect.Tag('NotFoundError')<
  NotFoundError,
  { readonly _tag: 'NotFoundError', readonly id: string }
>() {}

const getUser = effectOs
  .errors({
    NOT_FOUND: {
      message: 'User not found',
      data: z.object({ id: z.string() })
    },
  })
  .input(z.object({ id: z.string() }))
  .effect(({ input, errors }) =>
    Effect.gen(function* () {
      const userService = yield* UserService
      const user = yield* userService.findById(input.id)

      if (!user) {
        // Use oRPC's type-safe errors
        throw errors.NOT_FOUND({ id: input.id })
      }

      return user
    })
  )
```

## Using Effect.fn vs Effect.gen

Both generator syntaxes are supported:

```ts
// Using Effect.fn (recommended for procedures)
const procedureWithFn = effectOs
  .input(z.object({ id: z.string() }))
  .effect(
    Effect.fn(function* ({ input }) {
      const service = yield* MyService
      return yield* service.doSomething(input.id)
    })
  )

// Using Effect.gen with arrow function
const procedureWithGen = effectOs
  .input(z.object({ id: z.string() }))
  .effect(({ input }) =>
    Effect.gen(function* () {
      const service = yield* MyService
      return yield* service.doSomething(input.id)
    })
  )

// Simple effects without generators
const simpleProcedure = effectOs
  .input(z.object({ name: z.string() }))
  .effect(({ input }) =>
    Effect.succeed(`Hello, ${input.name}!`)
  )
```

## Traceable Spans

All Effect procedures are automatically traced with `Effect.withSpan`. By default, the span name is the procedure path (e.g., `users.getUser`):

```ts
// Router structure determines span names automatically
const router = os.router({
  users: os.router({
    // Span name: "users.get"
    get: effectOs
      .input(z.object({ id: z.string() }))
      .effect(
        Effect.fn(function* ({ input }) {
          const userService = yield* UserService
          return yield* userService.findById(input.id)
        })
      ),
    // Span name: "users.create"
    create: effectOs
      .input(z.object({ name: z.string() }))
      .effect(
        Effect.fn(function* ({ input }) {
          const userService = yield* UserService
          return yield* userService.create(input.name)
        })
      ),
  })
})
```

Use `.traced()` to override the default span name:

```ts
const getUser = effectOs
  .input(z.object({ id: z.string() }))
  .traced('custom.span.name') // Override the default path-based name
  .effect(
    Effect.fn(function* ({ input }) {
      const userService = yield* UserService
      return yield* userService.findById(input.id)
    })
  )
```

### Enabling OpenTelemetry

To enable tracing, include the OpenTelemetry layer in your runtime:

```ts
import { NodeSdk } from '@effect/opentelemetry'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

const TracingLive = NodeSdk.layer(Effect.sync(() => ({
  resource: { serviceName: 'my-service' },
  spanProcessor: [new SimpleSpanProcessor(new OTLPTraceExporter())]
})))

const AppLive = Layer.mergeAll(
  UserServiceLive,
  TracingLive
)

const runtime = ManagedRuntime.make(AppLive)
const effectOs = makeEffectORPC(runtime)
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
const effectOs = makeEffectORPC(runtime)

// With customized builder
const effectAuthedOs = makeEffectORPC(runtime, authedBuilder)
```

### `EffectBuilder`

Wraps an oRPC Builder with Effect support. Available methods:

| Method             | Description                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `.errors(map)`     | Add type-safe custom errors                                                     |
| `.meta(meta)`      | Set procedure metadata                                                          |
| `.route(route)`    | Configure OpenAPI route                                                         |
| `.input(schema)`   | Define input validation schema                                                  |
| `.output(schema)`  | Define output validation schema                                                 |
| `.use(middleware)` | Add middleware                                                                  |
| `.traced(name)`    | Add a traceable span for telemetry (optional, defaults to the procedure's path) |
| `.effect(handler)` | Define the Effect handler                                                       |

### `EffectDecoratedProcedure`

The result of calling `.effect()`. Extends standard oRPC `DecoratedProcedure` with Effect type preservation.

| Method                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `.errors(map)`          | Add more custom errors                        |
| `.meta(meta)`           | Update metadata                               |
| `.route(route)`         | Update route configuration                    |
| `.use(middleware)`      | Add middleware                                |
| `.callable(options?)`   | Make procedure directly invocable             |
| `.actionable(options?)` | Make procedure compatible with server actions |

## License

MIT
