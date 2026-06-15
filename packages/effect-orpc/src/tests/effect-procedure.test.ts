import { isProcedure } from "@orpc/server";
import { Layer, ManagedRuntime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

import { EffectDecoratedProcedure } from "../effect-procedure";
import { makeEffectRuntimeRunner } from "../runtime-source";
import {
  baseErrorMap,
  baseMeta,
  baseRoute,
  inputSchema,
  outputSchema,
} from "./shared";

vi.mock("@orpc/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@orpc/server")>();
  return {
    ...original,
    decorateMiddleware: vi.fn((mid) => ({
      mapInput: vi.fn((map) => [mid, map]),
    })),
    createProcedureClient: vi.fn(() => vi.fn()),
    createActionableClient: vi.fn(() => vi.fn()),
  };
});

const runtime = ManagedRuntime.make(Layer.empty);
const runner = makeEffectRuntimeRunner(runtime);

const handler = vi.fn();
const middleware = vi.fn();

const def = {
  middlewares: [middleware],
  errorMap: baseErrorMap,
  effectErrorMap: {},
  inputSchema,
  outputSchema,
  inputValidationIndex: 1,
  outputValidationIndex: 1,
  meta: baseMeta,
  route: baseRoute,
  handler,
  runner,
  runtime,
};

const decorated = new EffectDecoratedProcedure(def);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("effectDecoratedProcedure", () => {
  it("is a procedure", () => {
    expect(decorated).toSatisfy(isProcedure);
  });

  it(".errors", () => {
    const errors = {
      BAD_GATEWAY: {
        data: z.object({
          why: z.string(),
        }),
      },
    };

    const applied = decorated.errors(errors);
    expect(applied).not.toBe(decorated);
    expect(applied).toBeInstanceOf(EffectDecoratedProcedure);

    expect(applied["~effect"]).toEqual({
      ...def,
      effectErrorMap: errors,
      errorMap: {
        BAD_GATEWAY: {
          data: errors.BAD_GATEWAY.data,
          message: undefined,
          status: undefined,
        },
      },
    });

    // Preserves runtime
    expect(applied["~effect"].runner.runtime).toBe(runtime);
  });

  it(".meta", () => {
    const meta = { mode: "test" } as const;

    const applied = decorated.meta(meta);
    expect(applied).not.toBe(decorated);
    expect(applied).toBeInstanceOf(EffectDecoratedProcedure);

    expect(applied["~effect"]).toEqual({
      ...def,
      meta: { ...def.meta, ...meta },
    });

    // Preserves runtime
    expect(applied["~effect"].runner.runtime).toBe(runtime);
  });

  it(".route", () => {
    const route = { path: "/test", method: "GET", tags: ["hiu"] } as const;

    const applied = decorated.route(route);
    expect(applied).not.toBe(decorated);
    expect(applied).toBeInstanceOf(EffectDecoratedProcedure);

    expect(applied["~effect"]).toEqual({
      ...def,
      route: { ...def.route, ...route },
    });

    // Preserves runtime
    expect(applied["~effect"].runner.runtime).toBe(runtime);
  });

  describe(".use", () => {
    it("without map input", async () => {
      const mid = vi.fn(({ next }) =>
        next({ context: { fromMiddleware: true } }),
      );

      const applied = decorated.use(mid);
      expect(applied).not.toBe(decorated);
      expect(applied).toBeInstanceOf(EffectDecoratedProcedure);

      expect(applied["~effect"].middlewares).toHaveLength(
        def.middlewares.length + 1,
      );
      expect(applied["~effect"].middlewares[0]).toBe(def.middlewares[0]);

      const wrapped = applied["~effect"].middlewares[1]!;
      let nextCalls = 0;
      let nextOptions: unknown;
      const next = <TContext extends Record<PropertyKey, unknown>>(options?: {
        context?: TContext;
      }) => {
        nextCalls++;
        nextOptions = options;
        return Promise.resolve({
          output: "ok",
          context: options?.context ?? ({} as TContext),
        });
      };
      await expect(
        wrapped(
          {
            context: {},
            errors: {},
            path: [],
            procedure: applied,
            signal: undefined,
            lastEventId: undefined,
            next,
          },
          "input",
          vi.fn(),
        ),
      ).resolves.toEqual({
        output: "ok",
        context: { fromMiddleware: true },
      });
      expect(mid).toHaveBeenCalledOnce();
      expect(nextCalls).toBe(1);
      expect(nextOptions).toEqual({
        context: { fromMiddleware: true },
      });

      // Preserves runtime
      expect(applied["~effect"].runner.runtime).toBe(runtime);
    });

    it("with map input", () => {
      const mid = vi.fn();
      const map = vi.fn();

      const applied = decorated.use(mid, map);
      expect(applied).not.toBe(decorated);
      expect(applied).toBeInstanceOf(EffectDecoratedProcedure);

      expect(applied["~effect"]).toEqual({
        ...def,
        middlewares: [...def.middlewares, [mid, map]],
      });

      // Preserves runtime
      expect(applied["~effect"].runner.runtime).toBe(runtime);
    });
  });

  it(".callable", async () => {
    const { createProcedureClient } = await import("@orpc/server");
    const options = { context: { db: "postgres" } };

    const applied = decorated.callable(options);
    expect(applied).toBeInstanceOf(Function);
    expect(applied).toSatisfy(isProcedure);

    expect(createProcedureClient).toBeCalledTimes(1);
    expect(createProcedureClient).toBeCalledWith(decorated, options);

    // Can access procedure properties
    expect("use" in applied).toBe(true);
    expect("route" in applied).toBe(true);
    expect("meta" in applied).toBe(true);

    // Returns EffectDecoratedProcedure when chaining
    const chained = applied.route({});
    expect(chained).toBeInstanceOf(EffectDecoratedProcedure);
  });

  it(".actionable", async () => {
    const { createProcedureClient, createActionableClient } =
      await import("@orpc/server");
    const options = { context: { db: "postgres" } };

    const applied = decorated.actionable(options);
    expect(applied).toBeInstanceOf(Function);
    expect(applied).toSatisfy(isProcedure);

    expect(createProcedureClient).toBeCalledTimes(1);
    expect(createProcedureClient).toBeCalledWith(decorated, options);

    expect(createActionableClient).toBeCalledTimes(1);
    expect(createActionableClient).toBeCalledWith(
      vi.mocked(createProcedureClient).mock.results[0]!.value,
    );

    // Can access procedure properties
    expect("use" in applied).toBe(true);
    expect("route" in applied).toBe(true);
    expect("meta" in applied).toBe(true);

    // Returns EffectDecoratedProcedure when chaining
    const chained = applied.route({});
    expect(chained).toBeInstanceOf(EffectDecoratedProcedure);
  });
});

describe("effectDecoratedProcedure chaining", () => {
  it("preserves Effect types through method chains", () => {
    const applied = decorated
      .errors({ CUSTOM: { message: "custom error" } })
      .meta({ custom: true } as any)
      .route({ path: "/custom" });

    expect(applied).toBeInstanceOf(EffectDecoratedProcedure);
    expect(applied["~effect"].runner.runtime).toBe(runtime);
    expect(applied["~effect"].errorMap).toHaveProperty("CUSTOM");
  });
});
