import * as z from "zod";

import { baseContractProcedure, type ContractMeta, roleSchema } from "./shared";

export const pingOutputSchema = z.object({
  ok: z.literal(true),
  requestId: z.string(),
  role: roleSchema,
  path: z.string(),
  requestLabel: z.string(),
  aborted: z.boolean(),
});

export const requestContextOutputSchema = z.object({
  requestId: z.string(),
  role: roleSchema,
  hasExplicitRole: z.boolean(),
  origin: z.string(),
  path: z.string(),
  userAgent: z.string(),
  area: z.literal("root"),
});

export const diagnosticsContract = {
  ping: baseContractProcedure
    .meta({
      area: "diagnostics",
      feature: "ping",
      cacheable: true,
    } satisfies ContractMeta)
    .route({
      path: "/diagnostics/ping",
      method: "GET",
      tags: ["diagnostics", "public"],
    })
    .output(pingOutputSchema),
  requestContext: baseContractProcedure
    .meta({
      area: "diagnostics",
      feature: "request-context",
      cacheable: true,
    } satisfies ContractMeta)
    .route({
      path: "/diagnostics/request-context",
      method: "GET",
      tags: ["diagnostics", "debug"],
    })
    .output(requestContextOutputSchema),
};
