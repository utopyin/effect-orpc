# Examples

Runnable examples for `effect-orpc`.

Install dependencies from the repository root with `bun install`, then run an
example from its own folder. Examples depend on the local library through Bun
workspaces.

## Available Examples

- `hono-request-context`: Hono + oRPC + Effect with request-scoped `FiberRef`
  propagation using `withFiberContext` from `effect-orpc/node`.
