import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { getRequestContext, requestLoggingMiddleware } from "./http";
import { openAPIHandler, rpcHandler } from "./orpc/router";

const handleORPCRequest = async (
  request: Request,
  prefix: "/api" | "/rpc",
  context: ReturnType<typeof getRequestContext>,
) => {
  if (prefix === "/rpc") {
    return rpcHandler.handle(request, { prefix, context });
  }

  return openAPIHandler.handle(request, { prefix, context });
};

export const createApp = () => {
  const app = new Hono();

  app.use("*", requestId());
  app.use("/*", requestLoggingMiddleware);

  app.use("/*", async (c, next) => {
    const context = getRequestContext(c);

    for (const prefix of ["/rpc", "/api"] as const) {
      const { matched, response } = await handleORPCRequest(
        c.req.raw,
        prefix,
        context,
      );

      if (matched) {
        return c.newResponse(response.body, response);
      }
    }

    await next();
  });

  return app;
};
