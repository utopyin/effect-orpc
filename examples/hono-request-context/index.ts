import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError } from "@orpc/server";
import { CORSPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { serve } from "bun";
import { Effect, pipe } from "effect";
import { makeEffectORPC } from "effect-orpc";
import { withFiberContext } from "effect-orpc/node";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import * as z from "zod";

import { runtime } from "./runtime";
import { OrderService } from "./services/order";

const port = Number(process.env.PORT ?? "3000");

const app = new Hono();
app.use("*", requestId());

app.use("/*", async (c, next) => {
  const { method, path } = c.req;
  const currentRequestId = c.get("requestId");

  const requestEffect = Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({
      requestId: currentRequestId,
      service: "backend-service",
    });
    yield* Effect.logInfo(`[Request] ${method} ${path}`);
    yield* withFiberContext(() => next());
    yield* Effect.logInfo(`[Response] ${method} ${path} (${c.res.status})`);
  }).pipe(Effect.scoped, Effect.withSpan(`${method} ${path}`));

  await Effect.runPromise(requestEffect);
});

const o = makeEffectORPC(runtime);

const router = {
  orders: o
    .route({ path: "/orders", method: "GET" })
    .output(
      z.array(
        z.object({
          id: z.string(),
          items: z.array(z.string()),
          status: z.string(),
        }),
      ),
    )
    .effect(function* () {
      yield* Effect.logInfo("Handler: GET /orders - listing all orders");
      return yield* OrderService.listOrders();
    }),
  test: o
    .route({ path: "/test", method: "GET" })
    .output(z.string())
    .effect(function* () {
      return "ok";
    }),
};

const openAPIHandler = new OpenAPIHandler(router, {
  plugins: [
    new CORSPlugin(),
    new OpenAPIReferencePlugin({
      docsPath: "/docs",
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError(async (error) => {
      await runtime.runPromise(
        pipe(
          Effect.logError(
            "oRPC Error",
            error instanceof ORPCError ? [error, error.cause] : error,
          ),
        ),
      );
    }),
  ],
});

app.use("/*", async (c, next) => {
  const { matched, response } = await openAPIHandler.handle(c.req.raw, {
    prefix: "/api",
  });

  if (matched) {
    return c.newResponse(response.body, response);
  }

  await next();
});

const server = serve({
  fetch: app.fetch,
  port,
});

await runtime.runPromise(
  pipe(
    Effect.logInfo(`Server started on http://localhost:${port}`),
    Effect.annotateLogs("service", "backend-service"),
  ),
);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
