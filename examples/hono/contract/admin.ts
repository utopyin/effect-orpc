import * as z from "zod";

import {
  baseContractProcedure,
  type ContractMeta,
  orderSchema,
  roleSchema,
} from "./shared";

export const cacheReportOutputSchema = z.object({
  requestId: z.string(),
  role: roleSchema,
  inspectedVia: z.string(),
  cachedOrderPreview: z.array(orderSchema),
  storageRows: z.number(),
});

export const auditReplayInputSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(3),
});

export const auditReplayOutputSchema = z.object({
  requestId: z.string(),
  accepted: z.literal(true),
  replayed: z.array(z.string()),
});

export const adminContract = {
  cacheReport: baseContractProcedure
    .meta({
      area: "admin",
      feature: "cache-report",
      visibility: "internal",
      audit: true,
    } satisfies ContractMeta)
    .route({
      path: "/admin/cache/report",
      method: "GET",
      tags: ["admin", "cache"],
    })
    .output(cacheReportOutputSchema),
  auditReplay: baseContractProcedure
    .meta({
      area: "admin",
      feature: "audit-replay",
      visibility: "internal",
      audit: true,
    } satisfies ContractMeta)
    .route({
      path: "/admin/orders/replay",
      method: "DELETE",
      tags: ["admin", "orders"],
    })
    .input(auditReplayInputSchema)
    .output(auditReplayOutputSchema),
};
