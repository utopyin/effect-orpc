import { Effect } from "effect";

import { CacheService } from "./cache";

const HARDCODED_ORDERS: Record<
  string,
  { id: string; items: string[]; status: string }
> = {
  "ORD-001": { id: "ORD-001", items: ["laptop", "mouse"], status: "shipped" },
  "ORD-002": {
    id: "ORD-002",
    items: ["keyboard", "monitor"],
    status: "pending",
  },
  "ORD-003": { id: "ORD-003", items: ["headphones"], status: "delivered" },
};

export class OrderService extends Effect.Service<OrderService>()(
  "OrderService",
  {
    accessors: true,
    dependencies: [CacheService.Default],
    effect: Effect.gen(function* () {
      const cache = yield* CacheService;

      return {
        getOrder: (orderId: string) =>
          Effect.gen(function* () {
            yield* Effect.logInfo(`Fetching order: ${orderId}`);

            const cached = yield* cache.get(`order:${orderId}`);
            if (cached && typeof cached === "object" && "id" in cached) {
              return cached as { id: string; items: string[]; status: string };
            }

            const order = HARDCODED_ORDERS[orderId];
            if (order) {
              yield* cache.set(`order:${orderId}`, order);
              return order;
            }

            return { id: orderId, items: [], status: "not found" };
          }).pipe(
            Effect.annotateLogs("service", "OrderService"),
            Effect.withSpan("OrderService.getOrder"),
          ),
        listOrders: () =>
          Effect.gen(function* () {
            yield* Effect.logInfo("Listing all orders").pipe(
              Effect.annotateLogs({ count: 3 }),
            );

            const orders: Array<{
              id: string;
              items: string[];
              status: string;
            }> = [];

            for (const orderId of Object.keys(HARDCODED_ORDERS)) {
              const cached = yield* cache.get(`order:${orderId}`);
              if (cached && typeof cached === "object" && "id" in cached) {
                orders.push(
                  cached as { id: string; items: string[]; status: string },
                );
              } else {
                orders.push(HARDCODED_ORDERS[orderId]!);
              }
            }

            return orders;
          }).pipe(
            Effect.annotateLogs("app-service", "OrderService"),
            Effect.withSpan("OrderService.listOrders"),
          ),
      };
    }),
  },
) {}
