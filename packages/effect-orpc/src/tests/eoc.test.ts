import type { ContractProcedure, Schema } from "@orpc/contract";
import { ContractBuilder, isContractProcedure } from "@orpc/contract";
import { describe, expect, expectTypeOf, it } from "vitest";
import z from "zod";

import {
  type EffectContractBuilder,
  type EffectContractProcedureBuilder,
  type EffectContractProcedureBuilderWithInput,
  type EffectContractProcedureBuilderWithOutput,
  type EffectContractRouterBuilder,
  effectErrorMapToErrorMap,
  type EffectErrorMapToErrorMap,
  eoc,
  type MergedEffectErrorMap,
  ORPCTaggedError,
} from "../index";
import {
  baseErrorMap,
  baseMeta,
  type BaseMeta,
  baseRoute,
  generalSchema,
  inputSchema,
  outputSchema,
  ping,
  pong,
} from "./shared";

const builder = eoc
  .$meta(baseMeta)
  .$route(baseRoute)
  .$input(inputSchema)
  .errors(baseErrorMap);

describe("eoc", () => {
  it("preserves the original oc builder runtime behavior", () => {
    expect(eoc).toSatisfy(isContractProcedure);

    const withMeta = builder.$meta({ dev: true, log: true });
    expect(withMeta).toBeInstanceOf(ContractBuilder);
    expect(withMeta).not.toBe(builder);
    expect(withMeta["~orpc"]).toEqual({
      ...builder["~orpc"],
      meta: { dev: true, log: true },
    });

    const withRoute = builder.$route({ method: "GET", path: "/api" });
    expect(withRoute).toBeInstanceOf(ContractBuilder);
    expect(withRoute).not.toBe(builder);
    expect(withRoute["~orpc"]).toEqual({
      ...builder["~orpc"],
      route: { method: "GET", path: "/api" },
    });

    const withInitialInput = builder.$input(generalSchema);
    expect(withInitialInput).toBeInstanceOf(ContractBuilder);
    expect(withInitialInput).not.toBe(builder);
    expect(withInitialInput["~orpc"]).toEqual({
      ...builder["~orpc"],
      inputSchema: generalSchema,
    });

    const withErrors = builder.errors({
      BAD_GATEWAY: { data: outputSchema },
      OVERRIDE: { message: "override" },
    });
    expect(withErrors).toBeInstanceOf(ContractBuilder);
    expect(withErrors).not.toBe(builder);
    expect(withErrors["~orpc"]).toEqual({
      ...builder["~orpc"],
      errorMap: {
        BASE: { data: outputSchema },
        BAD_GATEWAY: { data: outputSchema },
        OVERRIDE: { message: "override" },
      },
    });

    const withMergedMeta = builder.meta({ log: true });
    expect(withMergedMeta).toBeInstanceOf(ContractBuilder);
    expect(withMergedMeta).not.toBe(builder);
    expect(withMergedMeta["~orpc"]).toEqual({
      ...builder["~orpc"],
      meta: { ...baseMeta, log: true },
    });

    const withMergedRoute = builder.route({ method: "GET", path: "/path" });
    expect(withMergedRoute).toBeInstanceOf(ContractBuilder);
    expect(withMergedRoute).not.toBe(builder);
    expect(withMergedRoute["~orpc"]).toEqual({
      ...builder["~orpc"],
      route: { ...baseRoute, method: "GET", path: "/path" },
    });

    const withInput = builder.input(generalSchema);
    expect(withInput).toBeInstanceOf(ContractBuilder);
    expect(withInput).not.toBe(builder);
    expect(withInput["~orpc"]).toEqual({
      ...builder["~orpc"],
      inputSchema: generalSchema,
    });

    const withOutput = builder.output(generalSchema);
    expect(withOutput).toBeInstanceOf(ContractBuilder);
    expect(withOutput).not.toBe(builder);
    expect(withOutput["~orpc"]).toEqual({
      ...builder["~orpc"],
      outputSchema: generalSchema,
    });
  });

  it("preserves the original oc router runtime behavior", () => {
    const prefixed = builder.prefix("/api").router({ ping, pong });
    expect(prefixed.ping["~orpc"].route.path).toBe("/api/base");
    expect(prefixed.ping["~orpc"].meta).toEqual(baseMeta);
    expect(prefixed.ping["~orpc"].errorMap).toEqual(baseErrorMap);

    const tagged = builder.tag("tag1", "tag2").router({ ping });
    expect(tagged.ping["~orpc"].route.tags).toEqual(["tag1", "tag2"]);
    expect(tagged.ping["~orpc"].meta).toEqual(baseMeta);
    expect(tagged.ping["~orpc"].errorMap).toEqual(baseErrorMap);

    const adapted = builder
      .prefix("/adapt")
      .tag("adapt")
      .router({ ping, pong });
    expect(adapted.ping["~orpc"].route.path).toBe("/adapt/base");
    expect(adapted.ping["~orpc"].route.tags).toEqual(["adapt"]);
  });

  it("accepts tagged error classes in .errors and normalizes them like the effect builder", () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
      status: 404,
      message: "User not found",
    }) {}

    const errors = {
      ...baseErrorMap,
      NOT_FOUND: UserNotFoundError,
    } as const;

    const applied = eoc.errors(errors);

    expect(applied["~orpc"].errorMap).toEqual(effectErrorMapToErrorMap(errors));
  });

  it("preserves the original oc builder types", () => {
    type AddedMeta = { meta1?: string; meta2?: number };

    expectTypeOf(eoc).toMatchTypeOf<
      ContractProcedure<
        Schema<unknown, unknown>,
        Schema<unknown, unknown>,
        Record<never, never>,
        Record<never, never>
      >
    >();

    expectTypeOf(builder).toMatchTypeOf<
      EffectContractBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.$meta<AddedMeta>({ meta1: "value" })).toMatchTypeOf<
      EffectContractBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        AddedMeta
      >
    >();

    expectTypeOf(builder.$route({ method: "GET", path: "/api" })).toMatchTypeOf<
      EffectContractBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.$input(generalSchema)).toMatchTypeOf<
      EffectContractBuilder<
        typeof generalSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(
      builder.errors({
        INVALID: { message: "invalid" },
        OVERRIDE: { message: "override" },
      }),
    ).toMatchTypeOf<
      EffectContractBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        MergedEffectErrorMap<
          typeof baseErrorMap,
          {
            INVALID: { message: string };
            OVERRIDE: { message: string };
          }
        >,
        BaseMeta
      >
    >();

    expectTypeOf(builder.meta({ log: true })).toMatchTypeOf<
      EffectContractProcedureBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.route({ method: "GET" })).toMatchTypeOf<
      EffectContractProcedureBuilder<
        typeof inputSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.input(generalSchema)).toMatchTypeOf<
      EffectContractProcedureBuilderWithInput<
        typeof generalSchema,
        Schema<unknown, unknown>,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.output(generalSchema)).toMatchTypeOf<
      EffectContractProcedureBuilderWithOutput<
        typeof inputSchema,
        typeof generalSchema,
        typeof baseErrorMap,
        BaseMeta
      >
    >();

    expectTypeOf(builder.prefix("/api")).toMatchTypeOf<
      EffectContractRouterBuilder<typeof baseErrorMap, BaseMeta>
    >();

    expectTypeOf(builder.tag("tag1", "tag2")).toMatchTypeOf<
      EffectContractRouterBuilder<typeof baseErrorMap, BaseMeta>
    >();

    expectTypeOf(builder.router({ ping, pong })).toEqualTypeOf<{
      ping: typeof ping;
      pong: typeof pong;
    }>();
  });

  it("keeps the eoc-specific tagged error typing", () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
    }) {}

    const tagged = eoc.errors({
      NOT_FOUND: UserNotFoundError,
    });

    expectTypeOf(tagged["~orpc"].errorMap).toEqualTypeOf<
      EffectErrorMapToErrorMap<{
        NOT_FOUND: typeof UserNotFoundError;
      }>
    >();
  });

  it("keeps the original oc builder constraints", () => {
    // @ts-expect-error invalid initial meta
    builder.$meta<{ meta1?: string }>({ meta1: 123 });

    // @ts-expect-error invalid route method
    builder.$route({ method: "INVALID" });

    // @ts-expect-error invalid schema
    builder.$input({});

    // @ts-expect-error error data must still be a schema
    builder.errors({ TOO_MANY_REQUESTS: { data: {} } });

    // @ts-expect-error invalid meta
    builder.meta({ meta: "INVALID" });

    // @ts-expect-error invalid method
    builder.route({ method: "INVALID" });

    // @ts-expect-error invalid schema
    builder.input({});

    // @ts-expect-error invalid schema
    builder.output({});

    // @ts-expect-error invalid prefix
    builder.prefix(1);

    // @ts-expect-error invalid tag
    builder.tag(1);

    // @ts-expect-error invalid router
    builder.router(123);

    builder.router({
      // @ts-expect-error conflicting meta def must still fail
      ping: {} as ContractProcedure<
        Schema<unknown, unknown>,
        typeof outputSchema,
        typeof baseErrorMap,
        { mode?: number }
      >,
    });
  });
});
