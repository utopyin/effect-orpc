import * as z from "zod";

import {
  baseContractProcedure,
  type ContractMeta,
  orderSchema,
  orderStatusSchema,
  roleSchema,
} from "./shared";

export const orderListInputSchema = z.object({
  status: orderStatusSchema.optional(),
  includeItems: z.coerce.boolean().optional().default(true),
});

export const orderListOutputSchema = z.object({
  requestId: z.string(),
  total: z.number(),
  filteredByStatus: orderStatusSchema.optional(),
  items: z.array(
    z.object({
      id: z.string(),
      items: z.array(z.string()).optional(),
      status: orderStatusSchema,
    }),
  ),
});

export const orderLookupInputSchema = z.object({
  orderId: z.string().min(1),
  includeItems: z.coerce.boolean().optional().default(true),
});

export const orderLookupOutputSchema = z.object({
  requestId: z.string(),
  requestLabel: z.string(),
  order: orderSchema.extend({
    items: z.array(z.string()).optional(),
  }),
});

export const createDraftInputSchema = z.object({
  orderId: z.string().min(3),
  items: z.array(z.string().min(1)).min(1),
  note: z.string().max(120).optional(),
});

export const createDraftOutputSchema = z.object({
  requestId: z.string(),
  draftId: z.number(),
  order: orderSchema.extend({
    note: z.string().optional(),
  }),
});

export const transitionInputSchema = z.object({
  orderId: z.string().min(1),
  nextStatus: z.enum(["pending", "shipped", "delivered"]),
});

export const transitionOutputSchema = z.object({
  requestId: z.string(),
  previousStatus: orderStatusSchema,
  currentStatus: orderStatusSchema,
  changedBy: roleSchema,
});

export const warmCacheInputSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(5),
});

export const warmCacheOutputSchema = z.object({
  requestId: z.string(),
  warmed: z.number(),
  orders: z.array(orderSchema),
});

export const ordersContract = {
  list: baseContractProcedure
    .meta({
      area: "orders",
      feature: "list",
      cacheable: true,
    } satisfies ContractMeta)
    .route({
      path: "/orders",
      method: "GET",
      tags: ["orders", "read"],
    })
    .input(orderListInputSchema)
    .output(orderListOutputSchema),
  find: baseContractProcedure
    .meta({
      area: "orders",
      feature: "find",
      cacheable: true,
    } satisfies ContractMeta)
    .route({
      path: "/orders/find",
      method: "GET",
      tags: ["orders", "lookup"],
    })
    .input(orderLookupInputSchema)
    .output(orderLookupOutputSchema),
  createDraft: baseContractProcedure
    .meta({
      area: "orders",
      feature: "create-draft",
      audit: true,
    } satisfies ContractMeta)
    .route({
      path: "/orders/drafts",
      method: "POST",
      tags: ["orders", "write"],
    })
    .input(createDraftInputSchema)
    .output(createDraftOutputSchema),
  transition: baseContractProcedure
    .meta({
      area: "orders",
      feature: "transition",
      audit: true,
    } satisfies ContractMeta)
    .errors({
      CONFLICT: {
        status: 409,
        message: "Delivered orders cannot transition backwards",
      },
    })
    .route({
      path: "/orders/status",
      method: "PATCH",
      tags: ["orders", "write"],
    })
    .input(transitionInputSchema)
    .output(transitionOutputSchema),
  warmCache: baseContractProcedure
    .meta({
      area: "orders",
      feature: "warm-cache",
      audit: true,
    } satisfies ContractMeta)
    .route({
      path: "/orders/cache/warm",
      method: "POST",
      tags: ["orders", "cache"],
    })
    .input(warmCacheInputSchema)
    .output(warmCacheOutputSchema),
};
