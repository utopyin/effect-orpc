import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { CORSPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Effect, pipe } from "effect";
import { implementEffect, makeEffectORPC } from "effect-orpc";
import * as z from "zod";

import { adminContract } from "../contract/admin";
import { diagnosticsContract } from "../contract/diagnostics";
import { orderLookupInputSchema, ordersContract } from "../contract/orders";
import {
  contractRouterBuilder,
  orderSchema,
  orderStatusSchema,
  type RequestContext,
} from "../contract/shared";
import { runtime } from "../runtime";
import { OrderService } from "../services/order";

export const contract = contractRouterBuilder.router({
  diagnostics: diagnosticsContract,
  orders: ordersContract,
  admin: adminContract,
});

const toTypedOrder = (order: {
  id: string;
  items: string[];
  status: string;
}): z.infer<typeof orderSchema> => orderSchema.parse(order);

const directProcedureBuilder =
  makeEffectORPC(runtime).$context<RequestContext>();

const directRouter = {
  orders: directProcedureBuilder
    .route({ path: "/orders", method: "GET" })
    .output(z.array(orderSchema))
    .effect(function* () {
      yield* Effect.logInfo("Handler: GET /orders - listing all orders");
      const service = yield* OrderService;
      const orders = yield* service.listOrders();
      return orders.map(toTypedOrder);
    }),
  test: directProcedureBuilder
    .route({ path: "/test", method: "GET" })
    .output(z.string())
    .effect(function* () {
      return "ok";
    }),
};

const contractImplementer = implementEffect(contract, runtime)
  .$context<RequestContext>()
  .use(({ context, next }) =>
    next({
      context: {
        requestLabel: `${context.role}:${context.requestId}`,
      },
    }),
  );

const ordersImplementer = contractImplementer.orders.use(({ next }) =>
  next({
    context: {
      section: "orders" as const,
    },
  }),
);

const adminImplementer = contractImplementer.admin.use(({ next }) =>
  next({
    context: {
      section: "admin" as const,
    },
  }),
);

const contractRouter = contractImplementer.router({
  diagnostics: {
    ping: contractImplementer.diagnostics.ping.handler(
      ({ context, signal, path }) => ({
        ok: true,
        requestId: context.requestId,
        role: context.role,
        path: path.join("."),
        requestLabel: context.requestLabel,
        aborted: signal?.aborted ?? false,
      }),
    ),
    requestContext: contractImplementer.diagnostics.requestContext.handler(
      ({ context }) => ({
        requestId: context.requestId,
        role: context.role,
        hasExplicitRole: context.hasExplicitRole,
        origin: context.origin,
        path: context.path,
        userAgent: context.userAgent,
        area: "root",
      }),
    ),
  },
  orders: {
    list: ordersImplementer.list.effect(function* ({ context, input }) {
      const service = yield* OrderService;
      const orders = yield* service
        .listOrders()
        .pipe(Effect.map((o) => o.map(toTypedOrder)));
      const filtered = input.status
        ? orders.filter((order) => order.status === input.status)
        : orders;

      return {
        requestId: context.requestId,
        total: filtered.length,
        filteredByStatus: input.status,
        items: filtered.map((order) => ({
          id: order.id,
          status: order.status as z.infer<typeof orderStatusSchema>,
          ...(input.includeItems ? { items: order.items } : {}),
        })),
      };
    }),
    find: ordersImplementer.find
      .use(
        ({ next }, input: z.infer<typeof orderLookupInputSchema>) =>
          next({
            context: {
              normalizedOrderId: input.orderId.trim().toUpperCase(),
            },
          }),
        (input) => ({
          ...input,
          orderId: input.orderId.trim().toUpperCase(),
        }),
      )
      .effect(function* ({ context, input, errors }) {
        const normalizedOrderId = input.orderId.trim().toUpperCase();
        const service = yield* OrderService;
        const order = yield* service.getOrder(normalizedOrderId);

        if (order.status === "not found") {
          return yield* Effect.fail(
            errors.NOT_FOUND({
              data: { orderId: context.normalizedOrderId },
            }),
          );
        }

        return {
          requestId: context.requestId,
          requestLabel: context.requestLabel,
          order: {
            ...toTypedOrder(order),
            ...(input.includeItems ? {} : { items: undefined }),
          },
        };
      }),
    createDraft: ordersImplementer.createDraft.effect(function* ({
      context,
      input,
      errors,
    }) {
      if (!context.hasExplicitRole) {
        return yield* Effect.fail(
          errors.UNAUTHORIZED({
            message: "Set x-role to operator or admin before creating drafts",
          }),
        );
      }

      if (context.role === "viewer") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            data: {
              requiredRole: "operator",
              actualRole: context.role,
            },
          }),
        );
      }

      const draftSeed = `${context.requestId}:${input.orderId}`;
      const draftId = Array.from(draftSeed).reduce(
        (total, char) => total + char.charCodeAt(0),
        0,
      );

      return {
        requestId: context.requestId,
        draftId,
        order: {
          id: input.orderId.trim().toUpperCase(),
          items: input.items,
          note: input.note,
          status: "draft",
        },
      };
    }),
    transition: ordersImplementer.transition.effect(function* ({
      context,
      input,
      errors,
    }) {
      if (!context.hasExplicitRole) {
        return yield* Effect.fail(errors.UNAUTHORIZED());
      }

      if (context.role === "viewer") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            data: {
              requiredRole: "operator",
              actualRole: context.role,
            },
          }),
        );
      }

      const service = yield* OrderService;
      const order = yield* service.getOrder(input.orderId.trim().toUpperCase());

      if (order.status === "not found") {
        return yield* Effect.fail(
          errors.NOT_FOUND({
            data: { orderId: input.orderId.trim().toUpperCase() },
          }),
        );
      }

      if (order.status === "delivered" && input.nextStatus !== "delivered") {
        return yield* Effect.fail(errors.CONFLICT());
      }

      const typedOrder = toTypedOrder(order);

      return {
        requestId: context.requestId,
        previousStatus: typedOrder.status,
        currentStatus: input.nextStatus,
        changedBy: context.role,
      };
    }),
    warmCache: ordersImplementer.warmCache.effect(function* ({
      context,
      input,
      errors,
    }) {
      if (!context.hasExplicitRole) {
        return yield* Effect.fail(
          errors.UNAUTHORIZED({
            message: "Set x-role to operator or admin before warming the cache",
          }),
        );
      }

      if (context.role === "viewer") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            data: {
              requiredRole: "operator",
              actualRole: context.role,
            },
          }),
        );
      }

      const service = yield* OrderService;
      const orders = yield* Effect.forEach(input.orderIds, (orderId) =>
        service.getOrder(orderId.trim().toUpperCase()),
      );

      return {
        requestId: context.requestId,
        warmed: orders.length,
        orders: orders
          .map(toTypedOrder)
          .filter((order) => order.status !== "not found"),
      };
    }),
  },
  admin: {
    cacheReport: adminImplementer.cacheReport.effect(function* ({
      context,
      errors,
    }) {
      if (context.role !== "admin") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            data: {
              requiredRole: "admin",
              actualRole: context.role,
            },
          }),
        );
      }

      const service = yield* OrderService;
      const orders = yield* service
        .listOrders()
        .pipe(Effect.map((o) => o.map(toTypedOrder)));
      yield* Effect.forEach(orders, (order) => service.getOrder(order.id));

      return {
        requestId: context.requestId,
        role: context.role,
        inspectedVia: context.section,
        cachedOrderPreview: orders,
        storageRows: orders.length,
      };
    }),
    auditReplay: adminImplementer.auditReplay.effect(function* ({
      context,
      input,
      errors,
    }) {
      if (context.role !== "admin") {
        return yield* Effect.fail(
          errors.FORBIDDEN({
            data: {
              requiredRole: "admin",
              actualRole: context.role,
            },
          }),
        );
      }

      yield* Effect.logInfo("Replaying order audit trail", {
        orderIds: input.orderIds,
        role: context.role,
      });

      return {
        requestId: context.requestId,
        accepted: true,
        replayed: input.orderIds.map((orderId) => orderId.trim().toUpperCase()),
      };
    }),
  },
});

export const router = {
  direct: directRouter,
  contract: contractRouter,
};

export const rpcHandler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
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

export const openAPIHandler = new OpenAPIHandler(router, {
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
