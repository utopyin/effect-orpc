import { ORPCError, type Meta } from "@orpc/contract";
import type {
  Context as ORPCContext,
  Middleware,
  MiddlewareNextFnOptions,
  MiddlewareOutputFn,
  MiddlewareResult,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { Promisable } from "@orpc/shared";
import { Cause, Effect, Exit, Option, Result } from "effect";

import type { EffectRuntimeRunner } from "./runtime-source";
import { runWithServices } from "./service-context-bridge";
import type { EffectErrorConstructorMap, EffectErrorMap } from "./tagged-error";
import {
  createEffectErrorConstructorMap,
  isORPCTaggedError,
} from "./tagged-error";
import type {
  EffectMiddleware,
  EffectMiddlewareOptions,
  EffectMiddlewareOutput,
  EffectMiddlewareResult,
  EffectOptionalProvider,
  EffectPipelineStep,
  EffectProcedureHandler,
  EffectProvider,
  EffectSpanConfig,
} from "./types";

type EffectTag = import("effect").Context.Key<any, any>;

function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  if (Cause.hasFails(cause)) {
    const reason = Cause.findFail(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR");
    }

    const error = reason.success.error;
    if (isORPCTaggedError(error)) {
      return error.toORPCError();
    }
    if (error instanceof ORPCError) {
      return error;
    }

    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
    });
  }

  if (Cause.hasDies(cause)) {
    const reason = Cause.findDie(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`Died by unknown reason`),
      });
    }
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: reason.success.defect,
    });
  }

  if (Cause.hasInterrupts(cause)) {
    const reason = Cause.findInterrupt(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`Unknown fiber got interrupted`),
      });
    }
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error(`${reason.success.fiberId} got interrupted`),
    });
  }

  return new ORPCError("INTERNAL_SERVER_ERROR");
}

export function createEffectProcedureHandler<
  TCurrentContext extends ORPCContext,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runner: EffectRuntimeRunner<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectFn: EffectProcedureHandler<
    TCurrentContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    any
  >;
  effectSteps?: readonly EffectPipelineStep[];
  spanConfig?: EffectSpanConfig;
  defaultCaptureStackTrace: () => string | undefined;
}): ProcedureHandler<
  TCurrentContext,
  TInput,
  TOutput,
  any,
  TMeta & Record<never, never>
> {
  const {
    runner,
    effectErrorMap,
    effectFn,
    effectSteps = [],
    spanConfig,
    defaultCaptureStackTrace,
  } = options;

  return async (opts) => {
    const effectOpts: ProcedureHandlerOptions<
      TCurrentContext,
      TInput,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta & Record<never, never>
    > = {
      context: opts.context,
      input: opts.input,
      path: opts.path,
      procedure: opts.procedure,
      signal: opts.signal,
      lastEventId: opts.lastEventId,
      errors: createEffectErrorConstructorMap(effectErrorMap),
    };

    const spanName = spanConfig?.name ?? opts.path.join(".");
    const captureStackTrace =
      spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
    const resolver = Effect.fnUntraced(effectFn);
    const handlerEffect = resolver(effectOpts);
    const tracedEffect = Effect.withSpan(
      runEffectPipeline({
        baseOptions: effectOpts,
        effectErrorMap,
        final: (context) =>
          Effect.map(
            context === effectOpts.context
              ? handlerEffect
              : resolver({ ...effectOpts, context }),
            (output) => ({ output, context: {} }),
          ),
        input: opts.input,
        steps: effectSteps,
      }),
      spanName,
      { captureStackTrace },
    );
    const exit = await runner.runPromiseExit(tracedEffect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause);
    }

    return exit.value.output as TOutput;
  };
}

export function createEffectPipelineMiddleware<
  TCurrentContext extends ORPCContext,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runner: EffectRuntimeRunner<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  steps: readonly EffectPipelineStep[];
}): Middleware<
  TCurrentContext,
  Record<never, never>,
  unknown,
  TOutput,
  any,
  TMeta
> {
  const { runner, effectErrorMap, steps } = options;

  return async (opts, input) => {
    const baseOptions = makeEffectOptions<
      TCurrentContext,
      unknown,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = runEffectPipeline<
      TCurrentContext,
      unknown,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >({
      baseOptions,
      effectErrorMap,
      final: (context) =>
        withCurrentServiceContext(() =>
          opts.next(
            context === opts.context
              ? undefined
              : { context: context as Record<PropertyKey, unknown> },
          ),
        ) as any,
      input,
      steps,
    });
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value as MiddlewareResult<Record<never, never>, TOutput>;
  };
}

export function createEffectProviderMiddleware<
  TCurrentContext extends ORPCContext,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
  TTag extends EffectTag,
>(options: {
  runner: EffectRuntimeRunner<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  tag: TTag;
  provider: EffectProvider<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta,
    TTag
  >;
}): Middleware<TCurrentContext, Record<never, never>, TInput, any, any, TMeta> {
  const { runner, effectErrorMap, tag, provider } = options;

  return async (opts, input) => {
    const effectOpts = makeEffectOptions<
      TCurrentContext,
      TInput,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = Effect.flatMap(provider(effectOpts), (service) =>
      Effect.provideService(
        withCurrentServiceContext(() => opts.next()),
        tag,
        service,
      ),
    );
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value as MiddlewareResult<Record<never, never>, any>;
  };
}

export function createEffectOptionalProviderMiddleware<
  TCurrentContext extends ORPCContext,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
  TTag extends EffectTag,
>(options: {
  runner: EffectRuntimeRunner<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  tag: TTag;
  provider: EffectOptionalProvider<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta,
    TTag
  >;
}): Middleware<TCurrentContext, Record<never, never>, TInput, any, any, TMeta> {
  const { runner, effectErrorMap, tag, provider } = options;

  return async (opts, input) => {
    const effectOpts = makeEffectOptions<
      TCurrentContext,
      TInput,
      TEffectErrorMap,
      TMeta
    >(opts, input, effectErrorMap);
    const effect = Effect.flatMap(provider(effectOpts), (service) =>
      Option.match(service, {
        onNone: () => withCurrentServiceContext(() => opts.next()),
        onSome: (value) =>
          Effect.provideService(
            withCurrentServiceContext(() => opts.next()),
            tag,
            value,
          ),
      }),
    );
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value as MiddlewareResult<Record<never, never>, any>;
  };
}

// todo(utopy): make this check more comprehensive, maybe add a Symbol to the EffectMiddleware type
export function isEffectMiddleware(
  value: unknown,
): value is EffectMiddleware<
  ORPCContext,
  ORPCContext,
  unknown,
  unknown,
  EffectErrorMap,
  unknown,
  Meta
> {
  return (
    typeof value === "function" &&
    value.constructor?.name === "GeneratorFunction"
  );
}

function makeEffectOptions<
  TCurrentContext extends ORPCContext,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
>(
  opts: Parameters<
    Middleware<TCurrentContext, any, TInput, any, any, TMeta>
  >[0],
  input: TInput,
  effectErrorMap: TEffectErrorMap,
): ProcedureHandlerOptions<
  TCurrentContext,
  TInput,
  EffectErrorConstructorMap<TEffectErrorMap>,
  TMeta & Record<never, never>
> {
  return {
    context: opts.context,
    input,
    path: opts.path,
    procedure: opts.procedure as any,
    signal: opts.signal,
    lastEventId: opts.lastEventId,
    errors: createEffectErrorConstructorMap(effectErrorMap),
  };
}

function runEffectPipeline<
  TCurrentContext extends ORPCContext,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
>(options: {
  baseOptions: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >;
  effectErrorMap: TEffectErrorMap;
  final: (
    context: TCurrentContext,
  ) => Effect.Effect<
    EffectMiddlewareResult<Record<never, never>, TOutput>,
    unknown,
    TRequirementsProvided
  >;
  input: TInput;
  steps: readonly EffectPipelineStep[];
}): Effect.Effect<
  EffectMiddlewareResult<ORPCContext, TOutput>,
  unknown,
  TRequirementsProvided
> {
  const run = (
    index: number,
    context: TCurrentContext,
  ): Effect.Effect<
    EffectMiddlewareResult<ORPCContext, TOutput>,
    unknown,
    TRequirementsProvided
  > => {
    const step = options.steps[index];
    if (!step) return options.final(context);

    const stepOptions = { ...options.baseOptions, context };

    if (step._tag === "provide") {
      return Effect.flatMap(step.provider(stepOptions as any), (service) =>
        Effect.provideService(run(index + 1, context), step.tag, service),
      );
    }

    if (step._tag === "provideOptional") {
      return Effect.flatMap(step.provider(stepOptions as any), (service) =>
        Option.match(service, {
          onNone: () => run(index + 1, context),
          onSome: (value) =>
            Effect.provideService(run(index + 1, context), step.tag, value),
        }),
      );
    }

    if (step._tag === "provideLayer") {
      return Effect.provide(run(index + 1, context), step.layer);
    }

    const nextTracker =
      createMiddlewareNextTracker<
        EffectMiddlewareResult<ORPCContext, TOutput>
      >();
    const effectOptions: EffectMiddlewareOptions<
      TCurrentContext,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    > = {
      context,
      path: stepOptions.path,
      procedure: stepOptions.procedure,
      signal: stepOptions.signal,
      lastEventId: stepOptions.lastEventId,
      errors: createEffectErrorConstructorMap(options.effectErrorMap),
      next: nextTracker.wrapNext(
        (...rest: [MiddlewareNextFnOptions<ORPCContext>?]) => {
          const nextContext = rest[0]?.context ?? {};
          return Effect.map(
            run(index + 1, { ...context, ...nextContext }),
            (result) => ({
              output: result.output,
              context: nextContext,
            }),
          ) as Effect.Effect<EffectMiddlewareResult<ORPCContext, TOutput>>;
        },
      ),
    };
    const effectOutput = makeEffectMiddlewareOutput<
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided
    >((output) => ({ output, context: {} }));
    const middlewareEffect = Effect.fnUntraced(step.middleware)(
      effectOptions,
      options.input,
      effectOutput,
    ) as Effect.Effect<EffectMiddlewareResult<ORPCContext, TOutput> | void>;

    return Effect.flatMap(middlewareEffect, (result) =>
      resolveEffectMiddlewareContinuation({
        autoNext: () => effectOptions.next(),
        nextInvoked: nextTracker.nextInvoked,
        nextResult: nextTracker.nextResult,
        result,
      }),
    );
  };

  return run(0, options.baseOptions.context);
}

function createMiddlewareNextTracker<T>() {
  let nextInvoked = false;
  let nextResult: T | undefined;

  return {
    get nextInvoked() {
      return nextInvoked;
    },
    get nextResult() {
      return nextResult;
    },
    wrapNext<Fn extends (...args: any) => Effect.Effect<T, any, any>>(
      nextFn: Fn,
    ): Fn {
      return ((...args: Parameters<Fn>) => {
        nextInvoked = true;
        return Effect.map(nextFn(...args), (result) => {
          nextResult = result;
          return result;
        });
      }) as Fn;
    },
  };
}

function resolveEffectMiddlewareContinuation<
  TContext extends ORPCContext,
  TOutput,
  TRequirementsProvided,
>(options: {
  result: EffectMiddlewareResult<TContext, TOutput> | void;
  nextInvoked: boolean;
  nextResult: EffectMiddlewareResult<TContext, TOutput> | undefined;
  autoNext: () => Effect.Effect<
    EffectMiddlewareResult<TContext, TOutput>,
    unknown,
    TRequirementsProvided
  >;
}): Effect.Effect<
  EffectMiddlewareResult<TContext, TOutput>,
  unknown,
  TRequirementsProvided
> {
  const { result, nextInvoked, nextResult, autoNext } = options;

  if (result !== undefined) {
    return Effect.succeed(result);
  }

  if (nextInvoked) {
    if (nextResult === undefined) {
      return Effect.die(
        new Error(
          "Effect middleware invoked next() but did not return its result",
        ),
      );
    }
    return Effect.succeed(nextResult);
  }

  return autoNext();
}

function makeEffectMiddlewareOutput<
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
>(
  output: MiddlewareOutputFn<TOutput>,
): EffectMiddlewareOutput<TOutput, TEffectErrorMap, TRequirementsProvided> {
  return (value: TOutput) => withCurrentServiceContext(() => output(value));
}

function withCurrentServiceContext<T, R = never>(
  fn: () => Promisable<T>,
): Effect.Effect<T, never, R> {
  return Effect.flatMap(Effect.context<R>(), (services) =>
    Effect.promise(() =>
      runWithServices(services, () => Promise.resolve(fn())),
    ),
  );
}
