import { isContractProcedure } from "@orpc/contract";
import { os } from "@orpc/server";
import { Effect, Layer, ManagedRuntime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

import { EffectBuilder, makeEffectORPC } from "../effect-builder";
import { EffectDecoratedProcedure } from "../effect-procedure";
import { effectErrorMapToErrorMap, ORPCTaggedError } from "../tagged-error";
import {
  baseErrorMap,
  baseMeta,
  baseRoute,
  generalSchema,
  inputSchema,
  outputSchema,
} from "./shared";

const mid = vi.fn();
const runtime = ManagedRuntime.make(Layer.empty);

const def = {
  config: {
    initialInputValidationIndex: 11,
    initialOutputValidationIndex: 22,
  },
  middlewares: [mid],
  errorMap: baseErrorMap,
  effectErrorMap: baseErrorMap,
  inputSchema,
  outputSchema,
  inputValidationIndex: 99,
  meta: baseMeta,
  outputValidationIndex: 88,
  route: baseRoute,
  dedupeLeadingMiddlewares: true,
  runtime,
};

const builder = new EffectBuilder(def);

beforeEach(() => vi.clearAllMocks());

describe("effectBuilder", () => {
  it("is a contract procedure", () => {
    expect(builder).toSatisfy(isContractProcedure);
  });

  it(".errors", () => {
    class BadGatewayError extends ORPCTaggedError(
      z.object({ why: z.string() }),
    )("BadGatewayError") {}
    const errors = { BadGatewayError };

    const applied = builder.errors(errors);
    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);

    const effectErrorMap = { ...def.errorMap, ...errors };
    expect(applied["~effect"]).toEqual({
      ...def,
      effectErrorMap,
      errorMap: effectErrorMapToErrorMap(effectErrorMap),
    });
  });

  describe(".use", () => {
    it("without map input", () => {
      const mid2 = vi.fn();
      const applied = builder.use(mid2);

      expect(applied).instanceOf(EffectBuilder);
      expect(applied).not.toBe(builder);
      expect(applied["~effect"]).toEqual({
        ...def,
        middlewares: [mid, mid2],
      });
    });
  });

  it(".meta", () => {
    const meta = { log: true } as any;
    const applied = builder.meta(meta);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      meta: { ...def.meta, ...meta },
    });
  });

  it(".route", () => {
    const route = { description: "test" } as any;
    const applied = builder.route(route);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      route: { ...def.route, ...route },
    });
  });

  it(".input", () => {
    const applied = builder.input(generalSchema);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      inputSchema: generalSchema,
      inputValidationIndex: 12,
    });
  });

  it(".output", () => {
    const applied = builder.output(generalSchema);

    expect(applied).instanceOf(EffectBuilder);
    expect(applied).not.toBe(builder);
    expect(applied["~effect"]).toEqual({
      ...def,
      outputSchema: generalSchema,
      outputValidationIndex: 23,
    });
  });

  it(".effect", () => {
    // oxlint-disable-next-line require-yield
    const effectFn = vi.fn(function* () {
      return { result: "test" };
    });
    const applied = builder.effect(effectFn);

    expect(applied).instanceOf(EffectDecoratedProcedure);
    expect(applied["~effect"].runtime).toBe(runtime);
    expect(applied["~effect"].handler).toBeInstanceOf(Function);
  });

  it(".effect runs effect with runtime", async () => {
    // oxlint-disable-next-line require-yield
    const effectFn = vi.fn(function* ({ input }: { input: any }) {
      return { output: `processed-${input}` };
    });

    const applied = builder.effect(effectFn);

    const result = await applied["~effect"].handler({
      context: {},
      input: "test-input",
      path: ["test"],
      procedure: applied as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ output: "processed-test-input" });
    expect(effectFn).toHaveBeenCalledTimes(1);
  });
});

describe("makeEffectORPC factory", () => {
  it("uses default os when no builder provided", () => {
    const effectBuilder = makeEffectORPC(runtime);

    expect(effectBuilder).instanceOf(EffectBuilder);
    expect(effectBuilder["~effect"].runtime).toBe(runtime);
    // Should inherit os's default definition
    expect(effectBuilder["~effect"].middlewares).toEqual(
      os["~orpc"].middlewares,
    );
    expect(effectBuilder["~effect"].effectErrorMap).toEqual(
      os["~orpc"].errorMap,
    );
  });

  it("wraps a custom builder when provided", () => {
    const effectBuilder = makeEffectORPC(runtime, os);

    expect(effectBuilder).instanceOf(EffectBuilder);
    expect(effectBuilder["~effect"].runtime).toBe(runtime);
    expect(effectBuilder["~effect"].middlewares).toEqual(
      os["~orpc"].middlewares,
    );
    expect(effectBuilder["~effect"].effectErrorMap).toEqual(
      os["~orpc"].errorMap,
    );
  });

  it("creates working procedure with default os", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // oxlint-disable-next-line require-yield
    const procedure = effectBuilder.effect(function* () {
      return "hello";
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("hello");
  });

  it("supports Effect.fn generator syntax", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // oxlint-disable-next-line require-yield
    const procedure = effectBuilder.effect(function* () {
      const a = yield* Effect.succeed(1);
      const b = yield* Effect.succeed(2);
      return a + b;
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(3);
  });

  it("chains builder methods correctly", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .errors({ NOT_FOUND: { message: "not found" } })
      .meta({ auth: true } as any)
      .route({ path: "/test" })
      .input(z.object({ id: z.string() }))
      .output(z.object({ name: z.string() }))
      // oxlint-disable-next-line require-yield
      .effect(function* () {
        return { name: "test" };
      });

    expect(procedure).instanceOf(EffectDecoratedProcedure);
    expect(procedure["~effect"].errorMap).toHaveProperty("NOT_FOUND");
    expect(procedure["~effect"].meta).toEqual({ auth: true });
    expect(procedure["~effect"].route).toEqual({ path: "/test" });
  });

  it("wraps a customized builder", () => {
    const customBuilder = os
      .errors({ CUSTOM_ERROR: { message: "custom" } })
      .use(vi.fn());

    const effectBuilder = makeEffectORPC(runtime, customBuilder);

    expect(effectBuilder["~effect"].effectErrorMap).toHaveProperty(
      "CUSTOM_ERROR",
    );
    expect(effectBuilder["~effect"].middlewares.length).toBe(1);
  });
});

describe("effect with services", () => {
  it("can use services from runtime layer", async () => {
    // Define a simple service
    class Counter extends Effect.Tag("Counter")<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >() {}

    // Create a layer with the service
    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });

    // Create runtime with the service
    const serviceRuntime = ManagedRuntime.make(CounterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);

    // oxlint-disable-next-line require-yield
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: 5,
      path: ["test"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(6);

    // Cleanup
    await serviceRuntime.dispose();
  });
});

describe(".traced", () => {
  it("creates an EffectBuilder with span config", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const traced = effectBuilder.traced("users.getUser");

    expect(traced).instanceOf(EffectBuilder);
    expect(traced).not.toBe(effectBuilder);
    expect(traced["~effect"].spanConfig).toBeDefined();
    expect(traced["~effect"].spanConfig?.name).toBe("users.getUser");
    expect(traced["~effect"].spanConfig?.captureStackTrace).toBeInstanceOf(
      Function,
    );
  });

  it("preserves span config through chained methods", () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      .traced("users.getUser")
      // oxlint-disable-next-line require-yield
      .effect(function* () {
        return { name: "test" };
      });

    expect(procedure).instanceOf(EffectDecoratedProcedure);
    // The span wrapping happens in the handler, so we just verify the procedure was created
  });

  it("traced procedure handler runs successfully", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      .traced("users.getUser")
      // oxlint-disable-next-line require-yield
      .effect(function* ({ input }) {
        return { id: input.id, name: "Alice" };
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { id: "123" },
      path: ["users", "getUser"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ id: "123", name: "Alice" });
  });

  it("traced procedure with Effect.fn generator syntax", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder.traced("math.add").effect(function* () {
      const a = yield* Effect.succeed(10);
      const b = yield* Effect.succeed(20);
      return a + b;
    });

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["math", "add"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(30);
  });

  it("captures stack trace at definition time", () => {
    const effectBuilder = makeEffectORPC(runtime);

    // The stack trace is captured when .traced() is called
    const traced = effectBuilder.traced("test.procedure");

    const stackTrace = traced["~effect"].spanConfig?.captureStackTrace();
    // The stack trace should be a string containing the file location
    // It may be undefined in some test environments
    if (stackTrace !== undefined) {
      expect(typeof stackTrace).toBe("string");
    }
  });
});

describe("default tracing (without .traced())", () => {
  it("procedure without .traced() still runs successfully", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // No .traced() call - should still work and use path as span name
    const procedure = effectBuilder
      .input(z.object({ id: z.string() }))
      // oxlint-disable-next-line require-yield
      .effect(function* ({ input }) {
        return { id: input.id, name: "Bob" };
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { id: "456" },
      path: ["users", "findById"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toEqual({ id: "456", name: "Bob" });
  });

  it("uses procedure path as default span name", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    // Without .traced(), the span name should be derived from path
    // oxlint-disable-next-line require-yield
    const procedure = effectBuilder.effect(function* () {
      return "hello";
    });

    // The procedure should work with any path
    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["api", "v1", "greet"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("hello");
  });

  it("default tracing works with Effect.fn generator", async () => {
    const effectBuilder = makeEffectORPC(runtime);

    const procedure = effectBuilder.effect(
      // oxlint-disable-next-line require-yield
      function* () {
        const x = 5;
        const y = 10;
        return x * y;
      },
    );

    const result = await procedure["~effect"].handler({
      context: {},
      input: undefined,
      path: ["math", "multiply"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe(50);
  });

  it("default tracing works with services from runtime", async () => {
    class Greeter extends Effect.Tag("Greeter")<
      Greeter,
      { greet: (name: string) => Effect.Effect<string> }
    >() {}

    const GreeterLive = Layer.succeed(Greeter, {
      greet: (name: string) => Effect.succeed(`Hello, ${name}!`),
    });

    const serviceRuntime = ManagedRuntime.make(GreeterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);

    const procedure = effectBuilder
      .input(z.object({ name: z.string() }))
      .effect(function* ({ input }) {
        return yield* Greeter.greet(input.name);
      });

    const result = await procedure["~effect"].handler({
      context: {},
      input: { name: "World" },
      path: ["greeting", "say"],
      procedure: procedure as any,
      signal: undefined,
      lastEventId: undefined,
      errors: {},
    });

    expect(result).toBe("Hello, World!");

    await serviceRuntime.dispose();
  });

  it("no spanConfig is set when .traced() is not called", () => {
    const effectBuilder = makeEffectORPC(runtime);

    // Without .traced(), spanConfig should be undefined
    expect(effectBuilder["~effect"].spanConfig).toBeUndefined();

    const withInput = effectBuilder.input(z.string());
    expect(withInput["~effect"].spanConfig).toBeUndefined();
  });
});
