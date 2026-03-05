# Hono Request Context

This example mirrors the flow from Rezrazi's `effect-orpc-hono` demo, adapted to
the split import API in this repository.

It demonstrates:

- Hono request middleware annotating logs with a request ID
- `makeEffectORPC` imported from `effect-orpc`
- `withFiberContext(() => next())` imported from `effect-orpc/node`
- nested Effect services preserving the same request-scoped annotations

## Run

```bash
cd /path/to/effect-orpc
bun install
cd examples/hono-request-context
bun start
```

The API is served on `http://localhost:3000/api` by default.

To override the port:

```bash
cd /path/to/effect-orpc/examples/hono-request-context
PORT=43123 bun start
```

## Optional Telemetry Stack

```bash
docker compose up
```
