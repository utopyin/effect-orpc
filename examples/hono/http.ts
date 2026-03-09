import { Effect } from "effect";
import { withFiberContext } from "effect-orpc/node";
import type { Context, MiddlewareHandler } from "hono";

import { roleSchema, type RequestContext } from "./contract/shared";

export const requestLoggingMiddleware: MiddlewareHandler = async (c, next) => {
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
};

export const getRequestContext = (c: Context): RequestContext => {
  const roleHeader = c.req.header("x-role");
  const parsedRole = roleSchema.safeParse(roleHeader);

  return {
    requestId: c.get("requestId"),
    role: parsedRole.success ? parsedRole.data : "viewer",
    hasExplicitRole: roleHeader !== undefined,
    origin: c.req.header("origin") ?? "unknown",
    path: c.req.path,
    userAgent: c.req.header("user-agent") ?? "unknown",
  };
};
