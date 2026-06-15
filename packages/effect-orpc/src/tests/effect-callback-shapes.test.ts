import { oc } from "@orpc/contract";
import { call, createRouterClient } from "@orpc/server";
import type { Context as ORPCContext } from "@orpc/server";
import { Context, Effect, Layer, ManagedRuntime, Option, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod";

import { implementEffect } from "../contract";
import { eos, makeEffectORPC } from "../effect-builder";
import type { EffectOrORPCMiddleware } from "../types";

type TestMiddleware<
  TOutContext extends ORPCContext = { readonly value: string },
> = EffectOrORPCMiddleware<
  ORPCContext | Record<never, never>,
  TOutContext,
  unknown,
  unknown,
  Record<never, never>,
  never,
  Record<never, never>
>;

type TestMiddlewareOptions = Parameters<TestMiddleware>[0];
type SpanMiddlewareOptions = Parameters<
  TestMiddleware<Record<never, never>>
>[0];

type MiddlewareShape = {
  readonly name: string;
  readonly middleware: TestMiddleware;
  readonly expected: string;
};

function effectHandlerShapes() {
  return [
    {
      name: "function*",
      handler: function* ({ input }: { input: number }) {
        const increment = yield* Effect.succeed(1);
        return input + increment;
      },
    },
    {
      name: "named Effect.fn",
      handler: Effect.fn("test.effect.named")(function* ({
        input,
      }: {
        input: number;
      }) {
        const increment = yield* Effect.succeed(1);
        return input + increment;
      }),
    },
    {
      name: "anonymous Effect.fn",
      handler: Effect.fn(function* ({ input }: { input: number }) {
        const increment = yield* Effect.succeed(1);
        return input + increment;
      }),
    },
    {
      name: "Effect.gen-returning function",
      handler: ({ input }: { input: number }) =>
        Effect.gen(function* () {
          const increment = yield* Effect.succeed(1);
          return input + increment;
        }),
    },
  ] as const;
}

function providerShapes(suffix: string) {
  return [
    {
      name: "function*",
      provider: function* ({ context }: { context: { value: string } }) {
        yield* Effect.void;
        return { value: `${context.value}:${suffix}:generator` };
      },
    },
    {
      name: "named Effect.fn",
      provider: Effect.fn("test.provider.named")(function* ({
        context,
      }: {
        context: { value: string };
      }) {
        yield* Effect.void;
        return { value: `${context.value}:${suffix}:named` };
      }),
    },
    {
      name: "anonymous Effect.fn",
      provider: Effect.fn(function* ({
        context,
      }: {
        context: { value: string };
      }) {
        yield* Effect.void;
        return { value: `${context.value}:${suffix}:anonymous` };
      }),
    },
    {
      name: "Effect.gen-returning function",
      provider: ({ context }: { context: { value: string } }) =>
        Effect.gen(function* () {
          yield* Effect.void;
          return { value: `${context.value}:${suffix}:effect-gen` };
        }),
    },
  ] as const;
}

function optionalProviderShapes(suffix: string) {
  return [
    {
      name: "function*",
      provider: function* ({ context }: { context: { value?: string } }) {
        yield* Effect.void;
        return Option.map(Option.fromNullable(context.value), (value) => ({
          value: `${value}:${suffix}:generator`,
        }));
      },
    },
    {
      name: "named Effect.fn",
      provider: Effect.fn("test.optional-provider.named")(function* ({
        context,
      }: {
        context: { value?: string };
      }) {
        yield* Effect.void;
        return Option.map(Option.fromNullable(context.value), (value) => ({
          value: `${value}:${suffix}:named`,
        }));
      }),
    },
    {
      name: "anonymous Effect.fn",
      provider: Effect.fn(function* ({
        context,
      }: {
        context: { value?: string };
      }) {
        yield* Effect.void;
        return Option.map(Option.fromNullable(context.value), (value) => ({
          value: `${value}:${suffix}:anonymous`,
        }));
      }),
    },
    {
      name: "Effect.gen-returning function",
      provider: ({ context }: { context: { value?: string } }) =>
        Effect.gen(function* () {
          yield* Effect.void;
          return Option.map(Option.fromNullable(context.value), (value) => ({
            value: `${value}:${suffix}:effect-gen`,
          }));
        }),
    },
  ] as const;
}

function middlewareShapes(): ReadonlyArray<MiddlewareShape> {
  return [
    {
      name: "native guard-only function",
      middleware: () => {},
      expected: "handler",
    },
    {
      name: "native next-returning function",
      middleware: ({ next }) => next({ context: { value: "native-next" } }),
      expected: "native-next",
    },
    {
      name: "function*",
      middleware: function* ({ next }: TestMiddlewareOptions) {
        yield* Effect.void;
        return yield* next({ context: { value: "generator" } });
      },
      expected: "generator",
    },
    {
      name: "named Effect.fn",
      middleware: Effect.fn("test.middleware.named")(function* ({
        next,
      }: TestMiddlewareOptions) {
        yield* Effect.void;
        return yield* next({ context: { value: "named" } });
      }),
      expected: "named",
    },
    {
      name: "anonymous Effect.fn",
      middleware: Effect.fn(function* ({ next }: TestMiddlewareOptions) {
        yield* Effect.void;
        return yield* next({ context: { value: "anonymous" } });
      }),
      expected: "anonymous",
    },
    {
      name: "Effect.gen-returning function",
      middleware: ({ next }) =>
        Effect.gen(function* () {
          yield* Effect.void;
          return yield* next({ context: { value: "effect-gen" } });
        }),
      expected: "effect-gen",
    },
    {
      name: "Effect.gen-returning guard-only function",
      middleware: () =>
        Effect.gen(function* () {
          yield* Effect.void;
        }),
      expected: "handler",
    },
  ];
}

describe("Effect callback shapes", () => {
  for (const { name, handler } of effectHandlerShapes()) {
    it(`.effect supports ${name}`, async () => {
      const procedure = eos.input(z.number()).effect(handler);

      await expect(call(procedure, 41)).resolves.toBe(42);
    });
  }

  it("contract implementer .effect supports Effect-returning handlers", async () => {
    const contract = {
      increment: oc.input(z.number()).output(z.number()),
    };
    const implementer = implementEffect(contract, Layer.empty);

    const named = implementer.increment.effect(
      Effect.fn("test.contract.effect")(function* ({ input }) {
        const increment = yield* Effect.succeed(1);
        return input + increment;
      }),
    );

    await expect(call(named, 41)).resolves.toBe(42);
  });

  for (const { name, provider } of providerShapes("provide")) {
    it(`.provide supports ${name}`, async () => {
      class RequestValue extends Context.Tag(`RequestValue:${name}`)<
        RequestValue,
        { readonly value: string }
      >() {}

      const procedure = eos
        .$context<{ value: string }>()
        .provide(RequestValue, provider)
        .effect(function* () {
          const service = yield* RequestValue;
          return service.value;
        });

      await expect(
        call(procedure, undefined, { context: { value: "request" } }),
      ).resolves.toContain("request:provide");
    });
  }

  for (const { name, provider } of optionalProviderShapes("optional")) {
    it(`.provideOptional supports ${name}`, async () => {
      class RequestValue extends Context.Tag(`OptionalRequestValue:${name}`)<
        RequestValue,
        { readonly value: string }
      >() {}

      const procedure = eos
        .$context<{ value?: string }>()
        .provideOptional(RequestValue, provider)
        .effect(function* () {
          return yield* Effect.serviceOption(RequestValue);
        });

      await expect(
        call(procedure, undefined, { context: { value: "request" } }),
      ).resolves.toSatisfy(
        (option: Option.Option<{ readonly value: string }>) =>
          Option.isSome(option) &&
          option.value.value.includes("request:optional"),
      );
      await expect(
        call(procedure, undefined, { context: {} }),
      ).resolves.toEqual(Option.none());
    });
  }

  for (const { name, middleware, expected } of middlewareShapes()) {
    it(`.use supports ${name}`, async () => {
      const procedure = eos.use(middleware).effect(function* ({ context }) {
        return "value" in context ? context.value : "handler";
      });

      await expect(call(procedure, undefined)).resolves.toBe(expected);
    });
  }

  for (const { name, middleware, expected } of middlewareShapes().filter(
    ({ name }) => !name.startsWith("native"),
  )) {
    it(`.middleware supports ${name}`, async () => {
      const reusable = eos.middleware(middleware);
      const procedure = eos.use(reusable).effect(function* ({ context }) {
        return "value" in context ? context.value : "handler";
      });

      await expect(call(procedure, undefined)).resolves.toBe(expected);
    });
  }

  it("Effect handlers keep their own spans inside routed procedure spans", async () => {
    const spans: Array<{
      readonly name: string;
      readonly parentName: string | undefined;
    }> = [];
    const spanNamesById = new Map<string, string>();
    const tracer = Tracer.make({
      context: (f) => f(),
      span(name, parent, context, links, startTime, kind) {
        const spanId = `span-${spans.length + 1}`;
        spans.push({
          name,
          parentName: Option.match(parent, {
            onNone: () => undefined,
            onSome: (span) => spanNamesById.get(span.spanId),
          }),
        });
        spanNamesById.set(spanId, name);
        const attributes = new Map<string, unknown>();

        return {
          _tag: "Span" as const,
          name,
          spanId,
          traceId: "trace",
          parent,
          context,
          status: { _tag: "Started" as const, startTime },
          attributes,
          links,
          sampled: true,
          kind,
          end() {},
          attribute(key: string, value: unknown) {
            attributes.set(key, value);
          },
          event() {},
          addLinks() {},
        };
      },
    });
    const tracedRuntime = ManagedRuntime.make(Layer.setTracer(tracer));
    const effectFnProcedure = makeEffectORPC(tracedRuntime)
      .use(
        Effect.fn("custom.middleware.span")(function* ({
          next,
        }: SpanMiddlewareOptions) {
          return yield* next();
        }),
      )
      .effect(
        Effect.fn("custom.handler.span")(function* () {
          return "ok";
        }),
      );
    const withSpanProcedure = makeEffectORPC(tracedRuntime).effect(() =>
      Effect.succeed("ok").pipe(Effect.withSpan("custom.with-span.handler")),
    );
    const client = createRouterClient({
      users: {
        effectFn: effectFnProcedure,
        withSpan: withSpanProcedure,
      },
    });

    try {
      await expect(client.users.effectFn(undefined)).resolves.toBe("ok");
      await expect(client.users.withSpan(undefined)).resolves.toBe("ok");
      expect(spans).toContainEqual({
        name: "users.effectFn",
        parentName: undefined,
      });
      expect(spans).toContainEqual({
        name: "custom.handler.span",
        parentName: "users.effectFn",
      });
      expect(spans).toContainEqual({
        name: "users.withSpan",
        parentName: undefined,
      });
      expect(spans).toContainEqual({
        name: "custom.with-span.handler",
        parentName: "users.withSpan",
      });
      expect(
        spans.filter(({ name }) => name === "custom.middleware.span"),
      ).toHaveLength(1);
    } finally {
      await tracedRuntime.dispose();
    }
  });
});
