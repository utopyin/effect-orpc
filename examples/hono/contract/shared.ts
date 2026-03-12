import { eoc, ORPCTaggedError } from "effect-orpc";
import * as z from "zod";

export const roleSchema = z.enum(["viewer", "operator", "admin"]);
export const orderStatusSchema = z.enum([
  "pending",
  "shipped",
  "delivered",
  "draft",
  "not found",
]);

export const orderSchema = z.object({
  id: z.string(),
  items: z.array(z.string()),
  status: orderStatusSchema,
});

export type Role = z.infer<typeof roleSchema>;
export type RequestContext = {
  requestId: string;
  role: Role;
  hasExplicitRole: boolean;
  origin: string;
  path: string;
  userAgent: string;
};

export type ContractMeta = {
  area?: "diagnostics" | "orders" | "admin";
  feature?: string;
  visibility?: "public" | "internal";
  cacheable?: boolean;
  audit?: boolean;
};

export class OrderNotFoundError extends ORPCTaggedError("OrderNotFoundError", {
  code: "NOT_FOUND",
  schema: z.object({ orderId: z.string() }),
}) {}

export class RoleForbiddenError extends ORPCTaggedError("RoleForbiddenError", {
  code: "FORBIDDEN",
  schema: z.object({
    requiredRole: z.string(),
    actualRole: roleSchema,
  }),
}) {}

export const baseContractProcedure = eoc.meta({
  visibility: "public",
  cacheable: false,
} satisfies ContractMeta);

export const contractRouterBuilder = eoc
  .errors({
    BAD_REQUEST: {
      status: 400,
      message: "The request payload is invalid",
    },
    UNAUTHORIZED: {
      status: 401,
      message: "Mutating routes require an explicit x-role header",
    },
    NOT_FOUND: OrderNotFoundError,
    FORBIDDEN: RoleForbiddenError,
    CONFLICT: {
      status: 409,
      message: "The requested order transition conflicts with current state",
    },
  })
  .prefix("/contract")
  .tag("contract-routes", "request-context");
