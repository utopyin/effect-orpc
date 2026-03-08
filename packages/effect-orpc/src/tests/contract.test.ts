import { oc, type InferSchemaOutput } from "@orpc/contract";
import { call, ORPCError, type Router } from "@orpc/server";
import { Effect, FiberRef, Layer, ManagedRuntime } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import z from "zod";

import { eoc, implementEffect, ORPCTaggedError } from "../index";
import { withFiberContext } from "../node";
import {
  baseErrorMap,
  baseMeta,
  inputSchema,
  outputSchema,
  pong,
} from "./shared";

class Counter extends Effect.Tag("Counter")<
  Counter,
  {
    readonly increment: (n: number) => Effect.Effect<number>;
  }
>() {}

const requestIdRef = FiberRef.unsafeMake("missing");

const runtime = ManagedRuntime.make(
  Layer.succeed(Counter, {
    increment: (n: number) => Effect.succeed(n + 1),
  }),
);

const contract = {
  users: {
    list: oc
      .input(z.object({ amount: z.number() }))
      .output(z.object({ next: z.number(), requestId: z.string() })),
  },
};

const typedContract = {
  ping: oc
    .errors(baseErrorMap)
    .meta(baseMeta)
    .input(inputSchema)
    .output(outputSchema),
  pong,
  nested: {
    ping: oc
      .errors(baseErrorMap)
      .meta(baseMeta)
      .input(inputSchema)
      .output(outputSchema),
    pong,
  },
};

describe("implementEffect", () => {
  it("mirrors the contract tree and adds effect support on leaves", async () => {
    const oe = implementEffect(contract, runtime);

    expect(oe.users).toBeDefined();
    expect(oe.users.list).toBeDefined();
    expect(oe.users.list.handler).toBeTypeOf("function");
    expect(oe.users.list.effect).toBeTypeOf("function");

    const procedure = oe.users.list.effect(function* ({ input }) {
      const counter = yield* Counter;
      const requestId = yield* FiberRef.get(requestIdRef);

      return {
        next: yield* counter.increment(input.amount),
        requestId,
      };
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* FiberRef.set(requestIdRef, "req-123");
        return yield* withFiberContext(() => call(procedure, { amount: 2 }));
      }),
    );

    expect(result).toEqual({
      next: 3,
      requestId: "req-123",
    });
  });

  it("preserves contract enforcement at the root router", async () => {
    const oe = implementEffect(contract, runtime);

    const router = oe.router({
      users: {
        list: oe.users.list.effect(function* ({ input }) {
          const counter = yield* Counter;

          return {
            next: yield* counter.increment(input.amount),
            requestId: yield* FiberRef.get(requestIdRef),
          };
        }),
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* FiberRef.set(requestIdRef, "req-456");
        return yield* withFiberContext(() =>
          call(router.users.list, { amount: 4 }),
        );
      }),
    );

    expect(result).toEqual({
      next: 5,
      requestId: "req-456",
    });

    expectTypeOf(router.users.list["~effect"]).toBeObject();
    expectTypeOf(router).toExtend<
      Router<typeof contract, Record<string, never>>
    >();
  });

  it("maps tagged errors and raw ORPCError values the same way as EffectBuilder", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            NOT_FOUND: UserNotFoundError,
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);

    const taggedProcedure = oe.users.find.effect(function* ({ input }) {
      return yield* Effect.fail(
        new UserNotFoundError({ data: { userId: input.userId } }),
      );
    });

    await expect(
      call(taggedProcedure, { userId: "u-1" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-1" },
    });

    const rawProcedure = oe.users.find.effect(function* () {
      return yield* Effect.fail(
        new ORPCError("FORBIDDEN", {
          data: { userId: "nope" },
        }),
      );
    });

    await expect(call(rawProcedure, { userId: "u-2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      data: { userId: "nope" },
    });
  });

  it("preserves tagged error constructors from eoc inside effect handlers", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            NOT_FOUND: UserNotFoundError,
            FORBIDDEN: {},
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);
    let taggedError:
      | ORPCError<"USER_NOT_FOUND_ERROR", { userId: string }>
      | undefined;
    let forbiddenError: ORPCError<"FORBIDDEN", unknown> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.NOT_FOUND({
        data: { userId: input.userId },
      });
      forbiddenError = errors.FORBIDDEN();

      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-3" });
    await expect(result).rejects.toMatchObject({
      code: "USER_NOT_FOUND_ERROR",
      data: { userId: "u-3" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
    expect(forbiddenError).toBeInstanceOf(ORPCError);
  });

  it("preserves tagged error constructors with custom code from eoc inside effect handlers", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
      code: "NOT_FOUND",
    }) {}

    const taggedContract = {
      users: {
        find: eoc
          .errors({
            UserNotFoundError,
            FORBIDDEN: {},
          })
          .input(z.object({ userId: z.string() }))
          .output(z.object({ userId: z.string() })),
      },
    };

    const oe = implementEffect(taggedContract, runtime);
    let taggedError: ORPCError<"NOT_FOUND", { userId: string }> | undefined;
    let forbiddenError: ORPCError<"FORBIDDEN", unknown> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.UserNotFoundError({
        data: { userId: input.userId },
      });
      forbiddenError = errors.FORBIDDEN();

      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-3" });
    await expect(result).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-3" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
    expect(forbiddenError).toBeInstanceOf(ORPCError);
  });

  it("preserves tagged error constructors through eoc.router contracts", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
    }) {}

    const routedContract = eoc
      .errors({
        NOT_FOUND: UserNotFoundError,
      })
      .router({
        users: {
          find: oc
            .input(z.object({ userId: z.string() }))
            .output(z.object({ userId: z.string() })),
        },
      });

    const oe = implementEffect(routedContract, runtime);
    let taggedError:
      | ORPCError<"USER_NOT_FOUND_ERROR", { userId: string }>
      | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.NOT_FOUND({ data: { userId: input.userId } });
      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-4" });
    await expect(result).rejects.toMatchObject({
      code: "USER_NOT_FOUND_ERROR",
      data: { userId: "u-4" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
  });

  it("preserves tagged error constructors with custom code through eoc.router contracts", async () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      schema: z.object({ userId: z.string() }),
      code: "NOT_FOUND",
    }) {}

    const routedContract = eoc
      .errors({
        UserNotFoundError,
      })
      .router({
        users: {
          find: oc
            .input(z.object({ userId: z.string() }))
            .output(z.object({ userId: z.string() })),
        },
      });

    const oe = implementEffect(routedContract, runtime);
    let taggedError: ORPCError<"NOT_FOUND", { userId: string }> | undefined;

    const procedure = oe.users.find.effect(function* ({ input, errors }) {
      taggedError = errors.UserNotFoundError({
        data: { userId: input.userId },
      });
      return yield* Effect.fail(taggedError);
    });

    const result = call(procedure, { userId: "u-4" });
    await expect(result).rejects.toMatchObject({
      code: "NOT_FOUND",
      data: { userId: "u-4" },
    });
    await expect(result).rejects.toBeInstanceOf(ORPCError);

    expect(taggedError).toBeInstanceOf(UserNotFoundError);
  });

  it("retains contract-first restrictions at the type level", () => {
    const oe = implementEffect(contract, runtime);

    expectTypeOf(oe.users.list.handler).toBeFunction();
    expectTypeOf(oe.users.list.effect).toBeFunction();
    // @ts-expect-error input is not a property of the implementer
    expect(oe.users.list.input).toBeUndefined();
  });

  it("lets contracts declare tagged error classes directly via eoc.errors", () => {
    class UserNotFoundError extends ORPCTaggedError("UserNotFoundError", {
      code: "NOT_FOUND",
      schema: z.object({ userId: z.string() }),
    }) {}

    const findContract = eoc
      .errors({
        NOT_FOUND: UserNotFoundError,
      })
      .input(z.object({ userId: z.string() }))
      .output(z.object({ userId: z.string() }));
    const errorInstance = new UserNotFoundError({
      data: { userId: "u-1" },
    });

    expect(findContract["~orpc"].errorMap.NOT_FOUND?.status).toBe(
      errorInstance.status,
    );
    expect(findContract["~orpc"].errorMap.NOT_FOUND?.message).toBe(
      errorInstance.message,
    );
    expect(findContract["~orpc"].errorMap.NOT_FOUND?.data).toBe(
      errorInstance.schema,
    );

    type ErrorMap = (typeof findContract)["~orpc"]["errorMap"];
    expectTypeOf<ErrorMap>().toMatchTypeOf<{
      NOT_FOUND: {
        status?: number;
        message?: string;
        data?: z.ZodType<{ userId: string }>;
      };
    }>();
  });

  it("enforces contract output typing for handlers", () => {
    const oe = implementEffect(contract, runtime);

    oe.users.list.effect(
      // @ts-expect-error effect() must return the contract output shape
      function* () {
        return { next: "wrong", requestId: 123 };
      },
    );

    oe.users.list.handler(
      // @ts-expect-error handler() must return the contract output shape
      () => ({ next: "wrong", requestId: 123 }),
    );

    const procedure = oe.users.list.effect(function* ({ input }) {
      return {
        next: input.amount + 1,
        requestId: "req-ok",
      };
    });

    type ProcedureOutput = InferSchemaOutput<
      NonNullable<(typeof procedure)["~orpc"]["outputSchema"]>
    >;
    expectTypeOf<ProcedureOutput>().toEqualTypeOf<{
      next: number;
      requestId: string;
    }>();
  });

  it("preserves upstream implementer root and router typing", () => {
    const oe = implementEffect(typedContract, runtime);

    expectTypeOf(oe.$context).toBeFunction();
    expectTypeOf(oe.$config).toBeFunction();

    const router = oe.router({
      ping: oe.ping.effect(function* ({ input }) {
        return { output: Number(input.input) };
      }),
      pong: oe.pong.handler(() => undefined),
      nested: {
        ping: oe.nested.ping.effect(function* ({ input }) {
          return { output: Number(input.input) };
        }),
        pong: oe.nested.pong.handler(() => undefined),
      },
    });

    expectTypeOf(router).toExtend<
      Router<typeof typedContract, Record<string, never>>
    >();

    oe.lazy(async () => ({
      default: {
        ping: oe.ping.effect(function* ({ input }) {
          return { output: Number(input.input) };
        }),
        pong: oe.pong.handler(() => undefined),
        nested: {
          ping: oe.nested.ping.effect(function* ({ input }) {
            return { output: Number(input.input) };
          }),
          pong: oe.nested.pong.handler(() => undefined),
        },
      },
    }));

    // @ts-expect-error missing nested/pong implementations must fail contract enforcement
    const missingRouter: Parameters<typeof oe.router>[0] = {
      ping: oe.ping.effect(function* ({ input }) {
        return { output: Number(input.input) };
      }),
    };

    oe.router(missingRouter);

    // @ts-expect-error missing nested/pong implementations must fail contract enforcement
    const missingLazyRouter: Awaited<
      ReturnType<Parameters<typeof oe.lazy>[0]>
    >["default"] = {
      ping: oe.ping.effect(function* ({ input }) {
        return { output: Number(input.input) };
      }),
    };

    oe.lazy(async () => ({
      default: missingLazyRouter,
    }));
  });

  it("preserves upstream implementer procedure typing for use and handler", () => {
    const oe = implementEffect(typedContract, runtime);

    const applied = oe.ping.use(
      ({ context, next, path, procedure, errors, signal }, input, output) => {
        expectTypeOf(input).toEqualTypeOf<{ input: string }>();
        expectTypeOf(context).toMatchTypeOf<Record<string, never>>();
        expectTypeOf(path).toEqualTypeOf<readonly string[]>();
        expectTypeOf(procedure["~orpc"]).toBeObject();
        expectTypeOf(output).toBeFunction();
        expectTypeOf(errors).toBeObject();
        expectTypeOf(signal).toEqualTypeOf<
          undefined | InstanceType<typeof AbortSignal>
        >();

        return next({
          context: {
            extra: true,
          },
        });
      },
    );

    expectTypeOf(applied.handler).toBeFunction();
    expectTypeOf(applied.effect).toBeFunction();

    oe.ping.handler(() => ({ output: 456 }));

    // @ts-expect-error invalid handler output should fail
    oe.ping.handler(() => ({ output: "invalid" }));

    // @ts-expect-error invalid effect output should fail
    oe.ping.effect(function* () {
      return { output: "invalid" };
    });
  });
});
