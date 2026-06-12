import type { InferSchemaOutput } from "@orpc/contract";
import { isContractProcedure } from "@orpc/contract";
import { call, os } from "@orpc/server";
import {
  Context,
  Effect,
  FiberRef,
  Layer,
  ManagedRuntime,
  Option,
} from "effect";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import z from "zod";

import { EffectBuilder, makeEffectORPC } from "../effect-builder";
import { EffectDecoratedProcedure } from "../effect-procedure";
import { withFiberContext } from "../node";
import { ORPCTaggedError, effectErrorMapToErrorMap } from "../tagged-error";
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
    class BadGatewayError extends ORPCTaggedError("BadGatewayError", {
      schema: z.object({ why: z.string() }),
    }) {}
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
    const effectFn = vi.fn(function* () {
      return { result: "test" };
    });
    const applied = builder.effect(effectFn);

    expect(applied).instanceOf(EffectDecoratedProcedure);
    expect(applied["~effect"].runtime).toBe(runtime);
    expect(applied["~effect"].handler).toBeInstanceOf(Function);
  });

  it(".effect runs effect with runtime", async () => {
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

  it(".effect does not inherit parent FiberRefs by default", async () => {
    const requestIdRef = FiberRef.unsafeMake("missing");
    const applied = builder.effect(function* () {
      return yield* FiberRef.get(requestIdRef);
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* FiberRef.set(requestIdRef, "req-123");
        return yield* Effect.promise(() =>
          applied["~effect"].handler({
            context: {},
            input: undefined,
            path: ["test"],
            procedure: applied as any,
            signal: undefined,
            lastEventId: undefined,
            errors: {},
          }),
        );
      }),
    );

    expect(result).toBe("missing");
  });

  it(".effect inherits parent FiberRefs with withFiberContext", async () => {
    const requestIdRef = FiberRef.unsafeMake("missing");
    const applied = builder.effect(function* () {
      return yield* FiberRef.get(requestIdRef);
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* FiberRef.set(requestIdRef, "req-123");
        return yield* withFiberContext(() =>
          applied["~effect"].handler({
            context: {},
            input: undefined,
            path: ["test"],
            procedure: applied as any,
            signal: undefined,
            lastEventId: undefined,
            errors: {},
          }),
        );
      }),
    );

    expect(result).toBe("req-123");
  });

  it(".effect merges context FiberRefs with runtime FiberRefs, prioritizing context FiberRefs", async () => {
    const requestIdRef = FiberRef.unsafeMake("missing");

    class Counter extends Effect.Tag("Counter")<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >() {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const serviceRuntime = ManagedRuntime.make(CounterLive);
    const effectBuilder = makeEffectORPC(serviceRuntime);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const requestId = yield* FiberRef.get(requestIdRef);
      const value = yield* Counter.increment(input as number);

      return { requestId, value };
    });

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* FiberRef.set(requestIdRef, "req-123");
          return yield* withFiberContext(() =>
            procedure["~effect"].handler({
              context: {},
              input: 5,
              path: ["test"],
              procedure: procedure as any,
              signal: undefined,
              lastEventId: undefined,
              errors: {},
            }),
          );
        }),
      );

      expect(result).toEqual({ requestId: "req-123", value: 6 });
    } finally {
      await serviceRuntime.dispose();
    }
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

    //
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

  it("can create a builder directly from a Layer", async () => {
    class Counter extends Effect.Tag("LayerCounter")<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >() {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const effectBuilder = makeEffectORPC(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    try {
      await expect(call(procedure, 5)).resolves.toBe(6);
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it("can start without a runtime and provide a Layer", async () => {
    class Counter extends Effect.Tag("ProvidedLayerCounter")<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >() {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const effectBuilder = makeEffectORPC().provide(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      input,
    }) {
      const counter = yield* Counter;
      return yield* counter.increment(input as number);
    });

    try {
      await expect(call(procedure, 5)).resolves.toBe(6);
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it("can wrap a custom builder without a runtime and provide a Layer", async () => {
    class Counter extends Effect.Tag("ProvidedLayerCustomBuilderCounter")<
      Counter,
      { increment: (n: number) => Effect.Effect<number> }
    >() {}

    const CounterLive = Layer.succeed(Counter, {
      increment: (n: number) => Effect.succeed(n + 1),
    });
    const customBuilder = os.use(({ next }) =>
      next({ context: { fromCustomBuilder: true } }),
    );
    const effectBuilder = makeEffectORPC(customBuilder).provide(CounterLive);
    const procedure = effectBuilder.input(z.number()).effect(function* ({
      context,
      input,
    }) {
      const counter = yield* Counter;
      return {
        fromCustomBuilder: context.fromCustomBuilder,
        value: yield* counter.increment(input as number),
      };
    });

    try {
      await expect(call(procedure, 5)).resolves.toEqual({
        fromCustomBuilder: true,
        value: 6,
      });
    } finally {
      await effectBuilder["~effect"].runtime.dispose();
    }
  });

  it(".provide makes a request-scoped service available to handlers", async () => {
    class CurrentUser extends Context.Tag("CurrentUser")<
      CurrentUser,
      { id: string }
    >() {}

    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .effect(function* () {
        return yield* CurrentUser;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-1" } } }),
    ).resolves.toEqual({ id: "u-1" });
  });

  it(".provide service overrides the same service from the runtime", async () => {
    class CurrentUser extends Context.Tag("CurrentUserOverride")<
      CurrentUser,
      { id: string }
    >() {}

    const serviceRuntime = ManagedRuntime.make(
      Layer.succeed(CurrentUser, { id: "runtime" }),
    );
    const effectBuilder = makeEffectORPC(serviceRuntime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .effect(function* () {
        return yield* CurrentUser;
      });

    try {
      await expect(
        call(procedure, undefined, { context: { user: { id: "request" } } }),
      ).resolves.toEqual({ id: "request" });
    } finally {
      await serviceRuntime.dispose();
    }
  });

  it("Effect .use yield* next() without return runs handler once", async () => {
    let runs = 0;
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }) {
        yield* Effect.void;
        yield* next();
      })
      .effect(function* () {
        runs += 1;
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runs).toBe(1);
  });

  it("Effect .use guard-only middleware without next runs handler once", async () => {
    let runs = 0;
    const procedure = makeEffectORPC(runtime)
      .use(function* () {
        yield* Effect.void;
      })
      .effect(function* () {
        runs += 1;
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runs).toBe(1);
  });

  it("Effect .use yield* next() without return stays in one runtime boundary", async () => {
    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }) {
        yield* next();
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it("Effect .use can read services from upstream .provide", async () => {
    class CurrentUser extends Context.Tag("MiddlewareCurrentUser")<
      CurrentUser,
      { id: string }
    >() {}

    let seenUser: { id: string } | undefined;
    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* () {
        seenUser = yield* CurrentUser;
      })
      .effect(function* () {
        return "ok";
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-2" } } }),
    ).resolves.toBe("ok");
    expect(seenUser).toEqual({ id: "u-2" });
  });

  it("Effect .middleware can create reusable generator middleware", async () => {
    const eos = makeEffectORPC(runtime);

    const reusable = eos.middleware(function* ({ next }, input: string) {
      expectTypeOf(input).toEqualTypeOf<string>();
      return yield* next({ context: { seenInput: input } });
    });

    const procedure = eos
      .input(z.string())
      .use(reusable)
      .effect(function* ({ context }) {
        expectTypeOf(context.seenInput).toEqualTypeOf<string>();
        return context.seenInput;
      });

    await expect(call(procedure, "ok")).resolves.toBe("ok");
  });

  it("Effect .middleware can use builder-provided services", async () => {
    class MiddlewareService extends Context.Tag("MiddlewareService")<
      MiddlewareService,
      { value: string }
    >() {}

    const eos = makeEffectORPC(runtime).provide(MiddlewareService, () =>
      Effect.succeed({ value: "provided" }),
    );

    const reusable = eos.middleware(function* ({ next }) {
      const service = yield* MiddlewareService;
      return yield* next({ context: { serviceValue: service.value } });
    });

    const procedure = eos.use(reusable).effect(function* ({ context }) {
      return context.serviceValue;
    });

    await expect(call(procedure, undefined)).resolves.toBe("provided");
  });

  it("Effect .use can enrich context through next", async () => {
    class CurrentUser extends Context.Tag("NextCurrentUser")<
      CurrentUser,
      { id: string }
    >() {}

    const effectBuilder = makeEffectORPC(runtime).$context<{
      user: { id: string };
    }>();
    const procedure = effectBuilder
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }, _input) {
        const user = yield* CurrentUser;
        return yield* next({ context: { userId: user.id } });
      })
      .effect(function* ({ context }) {
        return context.userId;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-3" } } }),
    ).resolves.toBe("u-3");
  });

  it("Effect .use can transform downstream output", async () => {
    const procedure = makeEffectORPC(runtime)
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        return yield* output(`${result.output}-wrapped`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("Effect .use can transform typed downstream output after .output", async () => {
    const procedure = makeEffectORPC(runtime)
      .output(z.string())
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${result.output}-wrapped`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("Effect .use can read typed input after .input", async () => {
    const procedure = makeEffectORPC(runtime)
      .input(z.object({ value: z.number() }))
      .use(function* ({ next }, input) {
        expectTypeOf(input).toMatchTypeOf<{ value: number }>();
        return yield* next({ context: { doubled: input.value * 2 } });
      })
      .effect(function* ({ context }) {
        return context.doubled;
      });

    await expect(call(procedure, { value: 21 })).resolves.toBe(42);
  });

  it("Effect .use can read typed input and output after .input().output()", async () => {
    const procedure = makeEffectORPC(runtime)
      .input(z.object({ value: z.number() }))
      .output(z.string())
      .use(function* ({ next }, input, output) {
        expectTypeOf(input).toMatchTypeOf<{ value: number }>();
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${input.value}:${result.output}`);
      })
      .effect(function* () {
        return "ok";
      });

    await expect(call(procedure, { value: 21 })).resolves.toBe("21:ok");
  });

  it("Effect .use can transform typed downstream output after .effect", async () => {
    const procedure = makeEffectORPC(runtime)
      .effect(function* () {
        return "ok";
      })
      .use(function* ({ next }, _input, output) {
        const result = yield* next();
        expectTypeOf(result.output).toEqualTypeOf<string>();
        return yield* output(`${result.output}-wrapped`);
      });

    await expect(call(procedure, undefined)).resolves.toBe("ok-wrapped");
  });

  it("runs contiguous Effect providers, middleware, and handler in one runtime boundary", async () => {
    class CurrentUser extends Context.Tag("SingleBoundaryCurrentUser")<
      CurrentUser,
      { id: string }
    >() {}

    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .$context<{ user: { id: string } }>()
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }) {
        const user = yield* CurrentUser;
        return yield* next({ context: { userId: user.id } });
      })
      .effect(function* ({ context }) {
        const user = yield* CurrentUser;
        return `${context.userId}:${user.id}`;
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-4" } } }),
    ).resolves.toBe("u-4:u-4");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it("runs procedure-level Effect providers and middleware with the handler in one runtime boundary", async () => {
    class CurrentUser extends Context.Tag("ProcedureBoundaryCurrentUser")<
      CurrentUser,
      { id: string }
    >() {}

    const runPromiseExit = vi.spyOn(runtime, "runPromiseExit");
    const procedure = makeEffectORPC(runtime)
      .$context<{ user: { id: string } }>()
      .effect(function* () {
        return "ok";
      })
      .provide(CurrentUser, ({ context }) => Effect.succeed(context.user))
      .use(function* ({ next }) {
        const user = yield* CurrentUser;
        const result = yield* next({ context: { userId: user.id } });
        return {
          ...result,
          output: `${result.output}:${user.id}`,
        };
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-5" } } }),
    ).resolves.toBe("ok:u-5");
    expect(runPromiseExit).toHaveBeenCalledTimes(1);
  });

  it(".provideOptional makes present request-scoped services available", async () => {
    class CurrentUser extends Context.Tag("OptionalCurrentUserPresent")<
      CurrentUser,
      { id: string }
    >() {}

    const procedure = makeEffectORPC(runtime)
      .$context<{ user?: { id: string } }>()
      .provideOptional(CurrentUser, ({ context }) =>
        Effect.succeed(Option.fromNullable(context.user)),
      )
      .effect(function* () {
        return yield* Effect.serviceOption(CurrentUser);
      });

    await expect(
      call(procedure, undefined, { context: { user: { id: "u-6" } } }),
    ).resolves.toEqual(Option.some({ id: "u-6" }));
  });

  it(".provideOptional leaves absent request-scoped services unavailable", async () => {
    class CurrentUser extends Context.Tag("OptionalCurrentUserAbsent")<
      CurrentUser,
      { id: string }
    >() {}

    const procedure = makeEffectORPC(runtime)
      .$context<{ user?: { id: string } }>()
      .provideOptional(CurrentUser, ({ context }) =>
        Effect.succeed(Option.fromNullable(context.user)),
      )
      .effect(function* () {
        return yield* Effect.serviceOption(CurrentUser);
      });

    await expect(call(procedure, undefined, { context: {} })).resolves.toEqual(
      Option.none(),
    );
  });

  it(".provideOptional does not satisfy required service access", () => {
    class OptionalService extends Context.Tag("OptionalServiceRequirement")<
      OptionalService,
      { readonly value: string }
    >() {}

    makeEffectORPC(runtime)
      .provideOptional(OptionalService, () =>
        Effect.succeed(Option.some({ value: "provided" })),
      )
      .effect(
        // @ts-expect-error provideOptional does not guarantee the service exists
        function* () {
          return yield* OptionalService;
        },
      );
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

    const procedure = effectBuilder.effect(function* () {
      const x = 5;
      const y = 10;
      return x * y;
    });

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

  it("enforces the declared output schema for effect handlers", () => {
    const declaredOutputSchema = z.object({ name: z.string() });

    makeEffectORPC(runtime)
      .input(z.string())
      .output(declaredOutputSchema)
      .effect(
        // @ts-expect-error input().output() should constrain the effect return type
        function* () {
          return { count: 1 };
        },
      );

    const procedure = makeEffectORPC(runtime)
      .output(declaredOutputSchema)
      // @ts-expect-error output() should constrain the effect return type
      .effect(function* () {
        return { count: 1 };
      });

    type ProcedureOutput = InferSchemaOutput<
      NonNullable<(typeof procedure)["~orpc"]["outputSchema"]>
    >;
    expectTypeOf<ProcedureOutput>().toEqualTypeOf<{ name: string }>();
  });

  it("requires handler services to come from the runtime or .provide", () => {
    class MissingService extends Context.Tag("MissingService")<
      MissingService,
      { readonly value: string }
    >() {}

    makeEffectORPC(runtime).effect(
      // @ts-expect-error MissingService is not available from the runtime or .provide
      function* () {
        return yield* MissingService;
      },
    );

    makeEffectORPC(runtime)
      .provide(MissingService, () => Effect.succeed({ value: "provided" }))
      .effect(function* () {
        return yield* MissingService;
      });
  });

  it("requires Effect middleware services to come from the runtime or .provide", () => {
    class MissingMiddlewareService extends Context.Tag(
      "MissingMiddlewareService",
    )<MissingMiddlewareService, { readonly value: string }>() {}

    makeEffectORPC(runtime)
      .use(
        // @ts-expect-error MissingMiddlewareService is not available from the runtime or .provide
        function* () {
          yield* MissingMiddlewareService;
        },
      )
      .effect(function* () {
        return "ok";
      });

    makeEffectORPC(runtime)
      .provide(MissingMiddlewareService, () =>
        Effect.succeed({ value: "provided" }),
      )
      .use(function* () {
        yield* MissingMiddlewareService;
      })
      .effect(function* () {
        return "ok";
      });
  });
});
