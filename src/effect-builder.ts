import type { ORPCErrorCode } from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  InferSchemaOutput,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import type {
  AnyMiddleware,
  BuilderDef,
  Context,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ORPCErrorConstructorMap,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { IntersectPick } from "@orpc/shared";
import type { ManagedRuntime } from "effect";

import {
  mergeErrorMap,
  mergeMeta,
  mergeRoute,
  ORPCError,
} from "@orpc/contract";
import {
  addMiddleware,
  Builder,
  decorateMiddleware,
  fallbackConfig,
} from "@orpc/server";
import { Cause, Effect, Exit } from "effect";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  EffectErrorMapToUnion,
  MergedEffectErrorMap,
} from "./tagged-error";

import { EffectDecoratedProcedure } from "./effect-procedure";
import {
  createEffectErrorConstructorMap,
  effectErrorMapToErrorMap,
  isORPCTaggedError,
} from "./tagged-error";

/**
 * Captures the stack trace at the call site for better error reporting in spans.
 * This is called at procedure definition time to capture where the procedure was defined.
 *
 * @returns A function that lazily extracts the relevant stack frame
 */
export function addSpanStackTrace(): () => string | undefined {
  const ErrorConstructor = Error as typeof Error & {
    stackTraceLimit?: number;
  };
  const limit = ErrorConstructor.stackTraceLimit;
  ErrorConstructor.stackTraceLimit = 3;
  const traceError = new Error();
  ErrorConstructor.stackTraceLimit = limit;
  let cache: false | string = false;
  return () => {
    if (cache !== false) {
      return cache;
    }
    if (traceError.stack !== undefined) {
      const stack = traceError.stack.split("\n");
      if (stack[3] !== undefined) {
        cache = stack[3].trim();
        return cache;
      }
    }
  };
}

/**
 * Configuration for Effect span tracing.
 */
export interface EffectSpanConfig {
  /**
   * The name of the span for telemetry.
   */
  name: string;
  /**
   * Function to lazily capture the stack trace at definition time.
   */
  captureStackTrace: () => string | undefined;
}

/**
 * Options passed to the Effect procedure handler.
 */
export interface EffectProcedureHandlerOptions<
  TCurrentContext extends Context,
  TInput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> extends Omit<
  ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    ORPCErrorConstructorMap<any>,
    TMeta
  >,
  "errors"
> {
  errors: EffectErrorConstructorMap<TEffectErrorMap>;
}

/**
 * Handler type for Effect procedures.
 * The handler receives procedure options and returns an Effect.
 */
export type EffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TMeta extends Meta,
> = (
  opt: EffectProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    TEffectErrorMap,
    TMeta
  >,
) => Effect.Effect<
  THandlerOutput,
  EffectErrorMapToUnion<TEffectErrorMap> | ORPCError<ORPCErrorCode, unknown>,
  TRequirementsProvided
>;

/**
 * Extended builder definition that includes the Effect ManagedRuntime.
 */
export interface EffectBuilderDef<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends BuilderDef<TInputSchema, TOutputSchema, ErrorMap, TMeta> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  /**
   * Optional span configuration for Effect tracing.
   */
  spanConfig?: EffectSpanConfig;
  /**
   * Effect-extended error map that supports both traditional errors and tagged errors.
   */
  effectErrorMap: TEffectErrorMap;
}

/**
 * Effect-native procedure builder that wraps an oRPC Builder instance
 * and adds Effect-specific capabilities while preserving Effect error
 * and requirements types.
 */
export class EffectBuilder<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> {
  "~orpc": EffectBuilderDef<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;

  constructor(
    def: EffectBuilderDef<
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
  ) {
    this["~orpc"] = def;
  }

  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @example
   * ```ts
   * // Traditional format
   * builder.errors({ BAD_REQUEST: { status: 400, message: 'Bad request' } })
   *
   * // Tagged error class
   * builder.errors({ USER_NOT_FOUND: UserNotFoundError })
   *
   * // Mixed
   * builder.errors({
   *   BAD_REQUEST: { status: 400 },
   *   USER_NOT_FOUND: UserNotFoundError,
   * })
   * ```
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      errorMap: mergeErrorMap(
        this["~orpc"].errorMap,
        effectErrorMapToErrorMap(errors),
      ),
      effectErrorMap: {
        ...this["~orpc"].effectErrorMap,
        ...errors,
      },
    });
  }

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      unknown,
      unknown,
      ORPCErrorConstructorMap<ErrorMap>,
      TMeta
    >,
  ): EffectBuilder<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;

  use(
    middleware: AnyMiddleware,
    mapInput?: MapInputMiddleware<any, any>,
  ): EffectBuilder<any, any, any, any, any, any, any, any> {
    const mapped = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware;

    return new EffectBuilder({
      ...this["~orpc"],
      middlewares: addMiddleware(this["~orpc"].middlewares, mapped),
    });
  }

  /**
   * Sets or updates the metadata.
   * The provided metadata is spared-merged with any existing metadata.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  meta(
    meta: TMeta,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      meta: mergeMeta(this["~orpc"].meta, meta),
    });
  }

  /**
   * Sets or updates the route definition.
   * The provided route is spared-merged with any existing route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  route(
    route: Route,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      route: mergeRoute(this["~orpc"].route, route),
    });
  }

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<USchema extends AnySchema>(
    schema: USchema,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    USchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      inputSchema: schema,
      inputValidationIndex:
        fallbackConfig(
          "initialInputValidationIndex",
          this["~orpc"].config.initialInputValidationIndex,
        ) + this["~orpc"].middlewares.length,
    });
  }

  /**
   * Defines the output validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Output Validation Docs}
   */
  output<USchema extends AnySchema>(
    schema: USchema,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    USchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      outputSchema: schema,
      outputValidationIndex:
        fallbackConfig(
          "initialOutputValidationIndex",
          this["~orpc"].config.initialOutputValidationIndex,
        ) + this["~orpc"].middlewares.length,
    });
  }

  /**
   * Adds a traceable span to the procedure for telemetry.
   * The span name is used for Effect tracing via `Effect.withSpan`.
   * Stack trace is captured at the call site for better error reporting.
   *
   * @param spanName - The name of the span for telemetry (e.g., 'users.getUser')
   * @returns An EffectBuilder with span tracing configured
   *
   * @example
   * ```ts
   * const getUser = effectOs
   *   .input(z.object({ id: z.string() }))
   *   .traced('users.getUser')
   *   .effect(function* ({ input }) {
   *     const userService = yield* UserService
   *     return yield* userService.findById(input.id)
   *   })
   * ```
   */
  traced(
    spanName: string,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~orpc"],
      spanConfig: {
        name: spanName,
        captureStackTrace: addSpanStackTrace(),
      },
    });
  }

  /**
   * Defines the handler of the procedure using an Effect.
   * The Effect is executed using the ManagedRuntime provided during builder creation.
   * The effect is automatically wrapped with `Effect.withSpan`.
   *
   * @see {@link https://orpc.dev/docs/procedure Procedure Docs}
   */
  effect<UFuncOutput>(
    effectFn: EffectProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      UFuncOutput,
      TEffectErrorMap,
      TRequirementsProvided,
      TMeta
    >,
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    Schema<UFuncOutput, UFuncOutput>,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    const { runtime, spanConfig } = this["~orpc"];
    // Capture stack trace at definition time for default tracing
    const defaultCaptureStackTrace = addSpanStackTrace();
    return new EffectDecoratedProcedure({
      ...this["~orpc"],
      handler: async (opts) => {
        const effectOpts: EffectProcedureHandlerOptions<
          TCurrentContext,
          InferSchemaOutput<TInputSchema>,
          TEffectErrorMap,
          TMeta
        > = {
          context: opts.context,
          input: opts.input,
          path: opts.path,
          procedure: opts.procedure,
          signal: opts.signal,
          lastEventId: opts.lastEventId,
          errors: createEffectErrorConstructorMap(this["~orpc"].effectErrorMap),
        };
        const baseEffect = effectFn(effectOpts);
        const spanName = spanConfig?.name ?? opts.path.join(".");
        const captureStackTrace =
          spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
        const tracedEffect = Effect.withSpan(baseEffect, spanName, {
          captureStackTrace,
        });
        const exit = await runtime.runPromiseExit(tracedEffect, {
          signal: opts.signal,
        });

        if (Exit.isFailure(exit)) {
          throw Cause.match(exit.cause, {
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

        return exit.value;
      },
    });
  }
}

/**
 * Any oRPC builder-like object that has the `~orpc` definition property.
 * This includes Builder, BuilderWithMiddlewares, ProcedureBuilder, etc.
 */
export interface AnyBuilderLike<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> {
  "~orpc": BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;
}

/**
 * Creates an Effect-aware procedure builder with the specified ManagedRuntime.
 * Uses the default `os` builder from `@orpc/server`.
 *
 * @param runtime - The ManagedRuntime that provides services for Effect procedures
 * @returns An EffectBuilder instance for creating Effect-native procedures
 *
 * @example
 * ```ts
 * import { makeEffectORPC } from '@orpc/effect'
 * import { Effect, Layer, ManagedRuntime } from 'effect'
 *
 * const runtime = ManagedRuntime.make(Layer.empty)
 * const effectOs = makeEffectORPC(runtime)
 *
 * const hello = effectOs.effect(() => Effect.succeed('Hello!'))
 * ```
 */
export function makeEffectORPC<TRequirementsProvided, TRuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
): EffectBuilder<
  Context,
  Context,
  Schema<unknown, unknown>,
  Schema<unknown, unknown>,
  Record<never, never>,
  Record<never, never>,
  TRequirementsProvided,
  TRuntimeError
>;

/**
 * Creates an Effect-aware procedure builder by wrapping an existing oRPC Builder
 * with the specified ManagedRuntime.
 *
 * @param runtime - The ManagedRuntime that provides services for Effect procedures
 * @param builder - The oRPC Builder instance to wrap (e.g., a customized `os`)
 * @returns An EffectBuilder instance that extends the original builder with Effect support
 *
 * @example
 * ```ts
 * import { makeEffectORPC } from '@orpc/effect'
 * import { os } from '@orpc/server'
 * import { Effect, Layer, ManagedRuntime } from 'effect'
 *
 * // Create a customized builder
 * const authedOs = os.use(authMiddleware)
 *
 * // Wrap it with Effect support
 * const runtime = ManagedRuntime.make(UserServiceLive)
 * const effectOs = makeEffectORPC(runtime, authedOs)
 *
 * const getUser = effectOs
 *   .input(z.object({ id: z.string() }))
 *   .effect(
 *     Effect.fn(function* ({ input }) {
 *       const userService = yield* UserService
 *       return yield* userService.findById(input.id)
 *     })
 *   )
 * ```
 */
export function makeEffectORPC<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder: AnyBuilderLike<TInputSchema, TOutputSchema, TErrorMap, TMeta>,
): EffectBuilder<
  Context,
  Context,
  TInputSchema,
  TOutputSchema,
  TErrorMap,
  TMeta,
  TRequirementsProvided,
  TRuntimeError
>;

export function makeEffectORPC<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder?: AnyBuilderLike<TInputSchema, TOutputSchema, TErrorMap, TMeta>,
): EffectBuilder<
  Context,
  Context,
  TInputSchema,
  TOutputSchema,
  TErrorMap,
  TMeta,
  TRequirementsProvided,
  TRuntimeError
> {
  const resolvedBuilder =
    builder ?? emptyBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta>();
  return new EffectBuilder({
    ...resolvedBuilder["~orpc"],
    effectErrorMap: resolvedBuilder["~orpc"].errorMap,
    runtime,
  });
}

function emptyBuilder<
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
>() {
  return new Builder<
    Record<never, never>,
    Record<never, never>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >({
    config: {},
    route: {},
    meta: {} as TMeta,
    errorMap: {} as TErrorMap,
    inputValidationIndex: fallbackConfig("initialInputValidationIndex"),
    outputValidationIndex: fallbackConfig("initialOutputValidationIndex"),
    middlewares: [],
    dedupeLeadingMiddlewares: true,
  });
}
