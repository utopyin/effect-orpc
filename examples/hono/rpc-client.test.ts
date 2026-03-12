import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import {
  type ContractRouterClient,
  inferRPCMethodFromContractRouter,
} from "@orpc/contract";
import { describe, expect, test } from "vitest";

import { createApp } from "./app";
import { contract } from "./orpc/router";

const createContractClient = (
  headers: Headers | Record<string, string> = {},
) => {
  const app = createApp();
  const inferContractMethod = inferRPCMethodFromContractRouter(contract);
  const link = new RPCLink({
    url: "http://hono.local/rpc",
    method: (options, path) => inferContractMethod(options, path.slice(1)),
    headers,
    fetch: async (request) => app.fetch(request),
  });

  return createORPCClient<ContractRouterClient<typeof contract>>(link, {
    path: ["contract"],
  });
};

describe("Hono example RPC client", () => {
  test("reads request context through the contract client", async () => {
    const client = createContractClient({
      origin: "https://frontend.example",
      "user-agent": "rpc-test-suite",
      "x-role": "operator",
      "x-request-id": "req-rpc-context",
    });

    const result = await client.diagnostics.requestContext();

    expect(result).toEqual({
      requestId: "req-rpc-context",
      role: "operator",
      hasExplicitRole: true,
      origin: "https://frontend.example",
      path: "/rpc/contract/diagnostics/requestContext",
      userAgent: "rpc-test-suite",
      area: "root",
    });
  });

  test("normalizes lookups and supports partial payloads", async () => {
    const client = createContractClient({
      "x-request-id": "req-find-order",
    });

    const result = await client.orders.find({
      orderId: " ord-001 ",
      includeItems: false,
    });

    expect(result.requestId).toBe("req-find-order");
    expect(result.requestLabel).toBe("viewer:req-find-order");
    expect(result.order).toEqual({
      id: "ORD-001",
      status: "shipped",
      items: undefined,
    });
  });

  test("returns a typed UNAUTHORIZED error without an explicit role", async () => {
    const client = createContractClient({
      "x-request-id": "req-create-draft",
    });

    try {
      await client.orders.createDraft({
        orderId: "ord-900",
        items: ["mouse"],
      });
      throw new Error("Expected createDraft to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      expect(error).toMatchObject({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Set x-role to operator or admin before creating drafts",
      });
    }
  });

  test("allows operator and admin flows through the RPC client", async () => {
    const operatorClient = createContractClient({
      "x-role": "operator",
      "x-request-id": "req-operator",
    });
    const adminClient = createContractClient({
      "x-role": "admin",
      "x-request-id": "req-admin",
    });

    const draft = await operatorClient.orders.createDraft({
      orderId: " ord-777 ",
      items: ["keyboard"],
      note: "priority order",
    });
    const report = await adminClient.admin.cacheReport();

    expect(draft.requestId).toBe("req-operator");
    expect(draft.order).toEqual({
      id: "ORD-777",
      items: ["keyboard"],
      note: "priority order",
      status: "draft",
    });

    expect(report).toMatchObject({
      requestId: "req-admin",
      role: "admin",
      inspectedVia: "admin",
      storageRows: 3,
    });
    expect(report.cachedOrderPreview).toHaveLength(3);
  });
});
