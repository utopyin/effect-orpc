# Hono Request Context

This example mirrors the flow from Rezrazi's `effect-orpc-hono` demo, adapted to
the split import API in this repository.

It demonstrates:

- Hono request middleware annotating logs with a request ID
- `makeEffectORPC` imported from `effect-orpc`
- `eoc` + `implementEffect` contract routes imported from `effect-orpc`
- `withFiberContext(() => next())` imported from `effect-orpc/node`
- nested Effect services preserving the same request-scoped annotations and
  references
- a contract router with:
  - shared router-level errors, prefixes, and OpenAPI tags
  - per-procedure metadata, inputs, outputs, and route definitions
  - typed request context passed from Hono into oRPC handlers
  - router-level and leaf-level middleware
  - both `.handler(...)` and `.effect(...)` implementations
  - traditional ORPC errors and tagged Effect errors in the same contract tree

## Run

```bash
cd /path/to/effect-orpc
bun install
cd examples/hono-request-context
bun start
```

The API is served on `http://localhost:3000/api` by default.
The RPC endpoint is served on `http://localhost:3000/rpc`.

OpenAPI docs are available at `http://localhost:3000/docs`.

Run the RPC client test suite with:

```bash
bun test
```

## Routes

Direct builder routes:

- `GET /api/orders`
- `GET /api/test`

Contract routes:

- `GET /api/contract/diagnostics/ping`
- `GET /api/contract/diagnostics/request-context`
- `GET /api/contract/orders`
- `GET /api/contract/orders/find`
- `POST /api/contract/orders/drafts`
- `PATCH /api/contract/orders/status`
- `POST /api/contract/orders/cache/warm`
- `GET /api/contract/admin/cache/report`
- `DELETE /api/contract/admin/orders/replay`

Mutating contract routes expect an explicit `x-role` header:

- `x-role: operator` for order writes
- `x-role: admin` for admin routes

Without `x-role`, the example falls back to `viewer` for read-only routes and
returns typed `UNAUTHORIZED` / `FORBIDDEN` responses for restricted operations.

To override the port:

```bash
cd /path/to/effect-orpc/examples/hono-request-context
PORT=43123 bun start
```

## Optional Telemetry Stack

```bash
docker compose up
```
