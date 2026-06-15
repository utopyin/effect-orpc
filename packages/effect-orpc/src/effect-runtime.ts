import { ORPCError, type Meta } from "@orpc/contract";
import type {
  Context,
  Middleware,
  MiddlewareNextFnOptions,
  MiddlewareOptions,
  MiddlewareOutputFn,
  MiddlewareResult,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { Promisable } from "@orpc/shared";
import { Cause, Effect, Exit, FiberRefs, Option } from "effect";

import { runWithFiberRefs } from "./fiber-context-bridge";
import type { EffectRuntimeRunner } from "./runtime-source";
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

type EffectTag = import("effect").Context.Tag<any, any>;

const HybridContinuationSymbol = Symbol("effect-orpc/HybridContinuation");

type MiddlewareNextTracker<T> = ReturnType<
  typeof createMiddlewareNextTracker<T>
>;

type EffectMiddlewareRuntimeOptions<
  TCurrentContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = EffectMiddlewareOptions<
  TCurrentContext,
  TOutput,
  TEffectErrorMap,
  TRequirementsProvided,
  TMeta
> & {
  readonly nextTracker: MiddlewareNextTracker<
    EffectMiddlewareResult<Context, TOutput>
  >;
  readonly output: EffectMiddlewareOutput<
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided
  >;
};

function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  return Cause.match(cause, {
    onDie(defect) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: defect,
      });
    },
    onFail(error) {
      if (isORPCTaggedError(error)) {
        return error.toORPCError();
      }
      if (error instanceof ORPCError) {
        return error;
      }
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: error,
      });
    },
    onInterrupt(fiberId) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`${fiberId} Interrupted`),
      });
    },
    onSequential(left) {
      return left;
    },
    onEmpty: new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error("Unknown error"),
    }),
    onParallel(left) {
      return left;
    },
  });
}

export function createEffectProcedureHandler<
  TCurrentContext extends Context,
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
    const handlerEffect = callEffectCallback(effectFn, effectOpts);
    const tracedEffect = Effect.withSpan(
      runEffectPipeline({
        baseOptions: effectOpts,
        effectErrorMap,
        final: (context) =>
          Effect.map(
            context === effectOpts.context
              ? handlerEffect
              : callEffectCallback(effectFn, { ...effectOpts, context }),
            (output) => ({ output, context: {} }),
          ),
        input: opts.input,
        runner,
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
  TCurrentContext extends Context,
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
        withCurrentFiberContext(() =>
          opts.next(
            context === opts.context
              ? undefined
              : { context: context as Record<PropertyKey, unknown> },
          ),
        ) as any,
      input,
      runner,
      steps,
    });
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value as MiddlewareResult<Record<never, never>, TOutput>;
  };
}

export function createEffectOrORPCMiddleware<
  TCurrentContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta extends Meta,
>(options: {
  runner: EffectRuntimeRunner<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  middleware: EffectMiddleware<
    TCurrentContext,
    TOutContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta
  >;
}): Middleware<TCurrentContext, TOutContext, TInput, TOutput, any, TMeta> {
  const { runner, effectErrorMap, middleware } = options;

  return async (opts, input, output) => {
    const effectOptions = makeEffectMiddlewareOptions<
      TCurrentContext,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >({
      effectErrorMap,
      final: opts.next,
      options: opts,
      output,
    });

    return runEffectOrORPCMiddlewareCallback<
      TCurrentContext,
      TOutContext,
      TInput,
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >({
      effectOptions,
      input,
      middleware,
      nativeNext: opts.next,
      runner,
      signal: opts.signal,
    });
  };
}

async function runEffectOrORPCMiddlewareCallback<
  TCurrentContext extends Context,
  TOutContext extends Context,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
>(options: {
  effectOptions: EffectMiddlewareRuntimeOptions<
    TCurrentContext,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta
  >;
  input: TInput;
  middleware: EffectMiddleware<
    TCurrentContext,
    TOutContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    TMeta
  >;
  nativeNext: () => Promisable<MiddlewareResult<TOutContext, TOutput>>;
  runner: EffectRuntimeRunner<TRequirementsProvided, unknown>;
  signal: AbortSignal | undefined;
}): Promise<MiddlewareResult<TOutContext, TOutput>> {
  const result = options.middleware(
    options.effectOptions,
    options.input,
    options.effectOptions.output,
  );

  const classified = classifyEffectOrORPCMiddlewareResult<
    TOutContext,
    TOutput,
    TRequirementsProvided
  >(result);

  switch (classified._tag) {
    case "nativeContinuation":
      return classified.result;
    case "nativeGuardOnly":
      return options.nativeNext();
    case "nativeResult":
      return classified.result;
    case "effect": {
      const exit = await options.runner.runPromiseExit(
        runEffectMiddlewareResult({
          autoNext: () => options.effectOptions.next(),
          effect: classified.effect,
          nextInvoked: options.effectOptions.nextTracker.nextInvoked,
          nextResult: options.effectOptions.nextTracker.nextResult,
        }),
        { signal: options.signal },
      );

      if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

      return exit.value as MiddlewareResult<TOutContext, TOutput>;
    }
  }
}

type ClassifiedEffectOrORPCMiddlewareResult<
  TOutContext extends Context,
  TOutput,
  TRequirementsProvided,
> =
  | {
      readonly _tag: "nativeContinuation";
      readonly result: MiddlewareResult<TOutContext, TOutput>;
    }
  | { readonly _tag: "nativeGuardOnly" }
  | {
      readonly _tag: "nativeResult";
      readonly result: MiddlewareResult<TOutContext, TOutput>;
    }
  | {
      readonly _tag: "effect";
      readonly effect: Effect.Effect<
        EffectMiddlewareResult<TOutContext, TOutput> | void,
        unknown,
        TRequirementsProvided
      >;
    };

function classifyEffectOrORPCMiddlewareResult<
  TOutContext extends Context,
  TOutput,
  TRequirementsProvided,
>(
  result: unknown,
): ClassifiedEffectOrORPCMiddlewareResult<
  TOutContext,
  TOutput,
  TRequirementsProvided
> {
  if (isHybridContinuation(result)) {
    return {
      _tag: "nativeContinuation",
      result: result as MiddlewareResult<TOutContext, TOutput>,
    };
  }

  if (Effect.isEffect(result) || isGeneratorIterator(result)) {
    return {
      _tag: "effect",
      effect: effectFromCallbackResult(result),
    };
  }

  if (result === undefined) {
    return { _tag: "nativeGuardOnly" };
  }

  return {
    _tag: "nativeResult",
    result: result as MiddlewareResult<TOutContext, TOutput>,
  };
}

function runEffectMiddlewareResult<
  TContext extends Context,
  TOutput,
  TRequirementsProvided,
>(options: {
  effect: Effect.Effect<
    EffectMiddlewareResult<TContext, TOutput> | void,
    unknown,
    TRequirementsProvided
  >;
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
  return Effect.flatMap(options.effect, (result) =>
    resolveEffectMiddlewareContinuation({
      autoNext: options.autoNext,
      nextInvoked: options.nextInvoked,
      nextResult: options.nextResult,
      result,
    }),
  );
}

function makeEffectMiddlewareOptions<
  TCurrentContext extends Context,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
>(options: {
  effectErrorMap: TEffectErrorMap;
  final: (
    ...rest: [MiddlewareNextFnOptions<Context>?]
  ) => Promisable<MiddlewareResult<Context, TOutput>>;
  options: Omit<
    MiddlewareOptions<
      TCurrentContext,
      TOutput,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta
    >,
    "next"
  >;
  output: MiddlewareOutputFn<TOutput>;
}): EffectMiddlewareRuntimeOptions<
  TCurrentContext,
  TOutput,
  TEffectErrorMap,
  TRequirementsProvided,
  TMeta
> {
  const nextTracker =
    createMiddlewareNextTracker<EffectMiddlewareResult<Context, TOutput>>();

  const effectOptions = {
    context: options.options.context,
    path: options.options.path,
    procedure: options.options.procedure,
    signal: options.options.signal,
    lastEventId: options.options.lastEventId,
    errors: createEffectErrorConstructorMap(options.effectErrorMap),
    next: nextTracker.wrapNext((...rest: [MiddlewareNextFnOptions<Context>?]) =>
      makeHybridMiddlewareContinuation({
        final: options.final,
        nextTracker,
        rest,
      }),
    ),
    nextTracker,
    output: makeEffectMiddlewareOutput<
      TOutput,
      TEffectErrorMap,
      TRequirementsProvided
    >(options.output),
  };

  return effectOptions;
}

function makeHybridMiddlewareContinuation<TOutput>(options: {
  final: (
    ...rest: [MiddlewareNextFnOptions<Context>?]
  ) => Promisable<MiddlewareResult<Context, TOutput>>;
  nextTracker: MiddlewareNextTracker<EffectMiddlewareResult<Context, TOutput>>;
  rest: [MiddlewareNextFnOptions<Context>?];
}): Effect.Effect<EffectMiddlewareResult<Context, TOutput>> {
  const nextContext = options.rest[0]?.context ?? {};
  const toEffectResult = (
    result: any,
  ): EffectMiddlewareResult<Context, TOutput> => ({
    output: result.output,
    context: nextContext,
  });
  const effect = Effect.map(
    withCurrentFiberContext(() => options.final(...options.rest) as any),
    toEffectResult,
  ) as Effect.Effect<EffectMiddlewareResult<Context, TOutput>>;

  return makeHybridContinuation(effect, {
    onResult: options.nextTracker.setNextResult,
    run: () => options.final(...options.rest) as any,
    toEffectResult,
  });
}

function makeHybridContinuation<TORPCResult, TEffectResult>(
  effect: Effect.Effect<TEffectResult>,
  options: {
    run: () => Promisable<TORPCResult>;
    toEffectResult: (result: TORPCResult) => TEffectResult;
    onResult?: (result: TEffectResult) => void;
  },
): Effect.Effect<TEffectResult> {
  markHybridContinuation(effect);
  attachPromiseLikeContinuation(effect, (onFulfilled, onRejected) =>
    Promise.resolve(options.run() as any)
      .then(options.toEffectResult)
      .then((result) => {
        options.onResult?.(result);
        return result;
      })
      .then(onFulfilled, onRejected),
  );
  return effect;
}

function markHybridContinuation(value: object): void {
  Object.defineProperty(value, HybridContinuationSymbol, {
    configurable: true,
    value: true,
  });
}

function attachPromiseLikeContinuation(
  value: object,
  then: (onFulfilled: any, onRejected: any) => PromiseLike<unknown>,
): void {
  // oxlint-disable-next-line unicorn/no-thenable -- the hybrid continuation intentionally satisfies Effect and oRPC promise protocols.
  Object.defineProperty(value, "then", {
    configurable: true,
    value: then,
  });
}

export function createEffectProviderMiddleware<
  TCurrentContext extends Context,
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
    const effect = Effect.flatMap(
      callEffectCallback(provider, effectOpts),
      (service) =>
        Effect.provideService(
          withCurrentFiberContext(() => opts.next()),
          tag,
          service,
        ),
    );
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value;
  };
}

export function createEffectOptionalProviderMiddleware<
  TCurrentContext extends Context,
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
    const effect = Effect.flatMap(
      callEffectCallback(provider, effectOpts),
      (service) =>
        Option.match(service, {
          onNone: () => withCurrentFiberContext(() => opts.next()),
          onSome: (value) =>
            Effect.provideService(
              withCurrentFiberContext(() => opts.next()),
              tag,
              value,
            ),
        }),
    );
    const exit = await runner.runPromiseExit(effect, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) throw toORPCErrorFromCause(exit.cause);

    return exit.value;
  };
}

function callEffectCallback(
  callback: (...args: Array<any>) => unknown,
  ...args: Array<unknown>
): Effect.Effect<any, any, any> {
  if (isGeneratorFunction(callback)) {
    return Effect.fnUntraced(callback as any)(...args);
  }

  return Effect.suspend(() => {
    try {
      return effectFromCallbackResult(callback(...args));
    } catch (error) {
      return Effect.fail(error);
    }
  });
}

function effectFromCallbackResult(
  result: unknown,
): Effect.Effect<any, any, any> {
  if (Effect.isEffect(result)) {
    return result;
  }

  if (isGeneratorIterator(result)) {
    return Effect.fnUntraced(function* () {
      return yield* result as any;
    })();
  }

  if (isPromiseLike(result)) {
    return Effect.promise(() => result);
  }

  return Effect.succeed(result);
}

function isGeneratorIterator(value: unknown): value is Generator<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "next" in value &&
    typeof value.next === "function" &&
    "throw" in value &&
    typeof value.throw === "function"
  );
}

function isHybridContinuation(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    HybridContinuationSymbol in value
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function isGeneratorFunction(
  value: unknown,
): value is (...args: Array<any>) => Generator<unknown> {
  return (
    typeof value === "function" &&
    value.constructor?.name === "GeneratorFunction"
  );
}

// todo(utopy): make this check more comprehensive, maybe add a Symbol to the EffectMiddleware type
export function isEffectMiddleware(
  value: unknown,
): value is EffectMiddleware<
  Context,
  Context,
  unknown,
  unknown,
  EffectErrorMap,
  unknown,
  Meta
> {
  return isGeneratorFunction(value);
}

export function isDecoratedMiddleware(value: unknown): boolean {
  return (
    typeof value === "function" && "mapInput" in value && "concat" in value
  );
}

function makeEffectOptions<
  TCurrentContext extends Context,
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
  TCurrentContext extends Context,
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
  runner: EffectRuntimeRunner<TRequirementsProvided, unknown>;
  steps: readonly EffectPipelineStep[];
}): Effect.Effect<
  EffectMiddlewareResult<Context, TOutput>,
  unknown,
  TRequirementsProvided
> {
  const run = (
    index: number,
    context: TCurrentContext,
  ): Effect.Effect<
    EffectMiddlewareResult<Context, TOutput>,
    unknown,
    TRequirementsProvided
  > => {
    const step = options.steps[index];
    if (!step) return options.final(context);

    const stepOptions = { ...options.baseOptions, context };

    if (step._tag === "provide") {
      return Effect.flatMap(
        callEffectCallback(step.provider, stepOptions),
        (service) =>
          Effect.provideService(run(index + 1, context), step.tag, service),
      );
    }

    if (step._tag === "provideOptional") {
      return Effect.flatMap(
        callEffectCallback(step.provider, stepOptions),
        (service) =>
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

    return Effect.flatMap(Effect.getFiberRefs, (fiberRefs) => {
      const makeThenable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        makeThenableEffect(
          effect,
          options.runner as EffectRuntimeRunner<any, unknown>,
          fiberRefs,
          stepOptions.signal,
        ) as Effect.Effect<A, E, R>;
      const nextTracker =
        createMiddlewareNextTracker<EffectMiddlewareResult<Context, TOutput>>(
          makeThenable,
        );
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
          (...rest: [MiddlewareNextFnOptions<Context>?]) => {
            const nextContext = rest[0]?.context ?? {};
            return Effect.map(
              run(index + 1, { ...context, ...nextContext }),
              (result) => ({
                output: result.output,
                context: nextContext,
              }),
            ) as Effect.Effect<EffectMiddlewareResult<Context, TOutput>>;
          },
        ),
      };
      const effectOutput = makeEffectMiddlewareOutput<
        TOutput,
        TEffectErrorMap,
        TRequirementsProvided
      >((output) => ({ output, context: {} }), makeThenable);
      const middlewareEffect = callEffectCallback(
        step.middleware,
        effectOptions,
        options.input,
        effectOutput,
      ) as Effect.Effect<EffectMiddlewareResult<Context, TOutput> | void>;

      return Effect.flatMap(middlewareEffect, (result) =>
        resolveEffectMiddlewareContinuation({
          autoNext: () => effectOptions.next(),
          nextInvoked: nextTracker.nextInvoked,
          nextResult: nextTracker.nextResult,
          result,
        }),
      );
    });
  };

  return run(0, options.baseOptions.context);
}

function createMiddlewareNextTracker<T>(
  makeThenable?: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>,
) {
  let nextInvoked = false;
  let nextResult: T | undefined;

  return {
    get nextInvoked() {
      return nextInvoked;
    },
    get nextResult() {
      return nextResult;
    },
    setNextResult(result: T) {
      nextResult = result;
    },
    wrapNext<Fn extends (...args: any) => Effect.Effect<T, any, any>>(
      nextFn: Fn,
    ): Fn {
      return ((...args: Parameters<Fn>) => {
        nextInvoked = true;
        const inner = nextFn(...args);
        const tracked = Effect.map(inner, (result) => {
          nextResult = result;
          return result;
        });
        if (isHybridContinuation(inner)) {
          markHybridContinuation(tracked);
          attachPromiseLikeContinuation(
            tracked,
            (inner as any).then.bind(inner),
          );
          return tracked;
        }
        return makeThenable ? makeThenable(tracked) : tracked;
      }) as Fn;
    },
  };
}

function resolveEffectMiddlewareContinuation<
  TContext extends Context,
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
  makeThenable?: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>,
): EffectMiddlewareOutput<TOutput, TEffectErrorMap, TRequirementsProvided> {
  return (value: TOutput) => {
    const effect = withCurrentFiberContext(() => output(value));
    return makeThenable ? makeThenable(effect) : effect;
  };
}

function makeThenableEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runner: EffectRuntimeRunner<any, unknown>,
  fiberRefs: FiberRefs.FiberRefs,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E, R> {
  if ("then" in effect) {
    return effect;
  }

  attachPromiseLikeContinuation(
    effect,
    (
      onFulfilled: ((value: A) => unknown) | undefined,
      onRejected: ((error: unknown) => unknown) | undefined,
    ) =>
      runNestedEffect(effect, runner, fiberRefs, signal).then(
        onFulfilled,
        onRejected,
      ),
  );

  return effect;
}

async function runNestedEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  runner: EffectRuntimeRunner<any, unknown>,
  fiberRefs: FiberRefs.FiberRefs,
  signal: AbortSignal | undefined,
): Promise<A> {
  const exit = await runner.runPromiseExit(withFiberRefs(effect, fiberRefs), {
    signal,
  });

  if (Exit.isFailure(exit)) {
    throw toORPCErrorFromCause(exit.cause);
  }

  return exit.value;
}

function withFiberRefs<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  parentFiberRefs: FiberRefs.FiberRefs,
): Effect.Effect<A, E, R> {
  return Effect.fiberIdWith((fiberId) =>
    Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
      Effect.setFiberRefs(
        FiberRefs.joinAs(fiberRefs, fiberId, parentFiberRefs),
      ).pipe(Effect.andThen(effect)),
    ),
  );
}

function withCurrentFiberContext<T>(fn: () => Promisable<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
    Effect.promise(() =>
      runWithFiberRefs(fiberRefs, () => Promise.resolve(fn())),
    ),
  );
}
