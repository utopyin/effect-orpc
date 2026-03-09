import { serve } from "bun";
import { Effect, pipe } from "effect";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { getRequestContext, requestLoggingMiddleware } from "./http";
import { openAPIHandler } from "./orpc/router";
import { runtime } from "./runtime";

const port = Number(process.env.PORT ?? "3000");

const app = new Hono();
app.use("*", requestId());
app.use("/*", requestLoggingMiddleware);

app.use("/*", async (c, next) => {
  const { matched, response } = await openAPIHandler.handle(c.req.raw, {
    prefix: "/api",
    context: getRequestContext(c),
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
