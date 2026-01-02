import type {
  AnySchema,
  ContractRouter,
  ErrorMap,
  HTTPPath,
  InferSchemaOutput,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import type {
  AnyMiddleware,
  BuilderConfig,
  BuilderDef,
  Context,
  Lazy,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ProcedureHandler,
  ProcedureHandlerOptions,
  Router,
} from "@orpc/server";
import type { IntersectPick } from "@orpc/shared";
import type { ManagedRuntime } from "effect";

import {
  mergeMeta,
  mergePrefix,
  mergeRoute,
  mergeTags,
  ORPCError,
} from "@orpc/contract";
import {
  addMiddleware,
  Builder,
  decorateMiddleware,
  fallbackConfig,
  lazy,
} from "@orpc/server";
import { Cause, Effect, Exit } from "effect";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  MergedEffectErrorMap,
} from "./tagged-error";
import type {
  AnyBuilderLike,
  EffectBuilderDef,
  EffectErrorMapToErrorMap,
  EffectProcedureBuilderWithInput,
  EffectProcedureHandler,
  EffectRouterBuilder,
  EnhancedEffectRouter,
  InferBuilderCurrentContext,
  InferBuilderErrorMap,
  InferBuilderInitialContext,
  InferBuilderInputSchema,
  InferBuilderMeta,
  InferBuilderOutputSchema,
} from "./types";

import { enhanceEffectRouter } from "./effect-enhance-router";
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
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  declare "~effect": EffectBuilderDef<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  declare "~orpc": BuilderDef<
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
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
    const { runtime, spanConfig, effectErrorMap, ...orpcDef } = def;
    this["~orpc"] = orpcDef;
    this["~effect"] = { runtime, spanConfig, effectErrorMap, ...orpcDef };
  }

  /**
   * Sets or overrides the config.
   *
   * @see {@link https://orpc.dev/docs/client/server-side#middlewares-order Middlewares Order Docs}
   * @see {@link https://orpc.dev/docs/best-practices/dedupe-middleware#configuration Dedupe Middleware Docs}
   */
  $config(
    config: BuilderConfig,
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
    const inputValidationCount =
      this["~effect"].inputValidationIndex -
      fallbackConfig(
        "initialInputValidationIndex",
        this["~effect"].config.initialInputValidationIndex,
      );
    const outputValidationCount =
      this["~effect"].outputValidationIndex -
      fallbackConfig(
        "initialOutputValidationIndex",
        this["~effect"].config.initialOutputValidationIndex,
      );

    return new EffectBuilder({
      ...this["~effect"],
      config,
      dedupeLeadingMiddlewares: fallbackConfig(
        "dedupeLeadingMiddlewares",
        config.dedupeLeadingMiddlewares,
      ),
      inputValidationIndex:
        fallbackConfig(
          "initialInputValidationIndex",
          config.initialInputValidationIndex,
        ) + inputValidationCount,
      outputValidationIndex:
        fallbackConfig(
          "initialOutputValidationIndex",
          config.initialOutputValidationIndex,
        ) + outputValidationCount,
    });
  }

  /**
   * Set or override the initial context.
   *
   * @see {@link https://orpc.dev/docs/context Context Docs}
   */
  $context<U extends Context>(): EffectBuilder<
    U & Record<never, never>,
    U,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    /**
     * We need `& Record<never, never>` to deal with `has no properties in common with type` error
     */

    return new EffectBuilder({
      ...this["~effect"],
      middlewares: [],
      inputValidationIndex: fallbackConfig(
        "initialInputValidationIndex",
        this["~effect"].config.initialInputValidationIndex,
      ),
      outputValidationIndex: fallbackConfig(
        "initialOutputValidationIndex",
        this["~effect"].config.initialOutputValidationIndex,
      ),
    });
  }

  /**
   * Sets or overrides the initial meta.
   *
   * @see {@link https://orpc.dev/docs/metadata Metadata Docs}
   */
  $meta<U extends Meta>(
    initialMeta: U,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    U & Record<never, never>,
    TRequirementsProvided,
    TRuntimeError
  > {
    /**
     * We need `& Record<never, never>` to deal with `has no properties in common with type` error
     */

    return new EffectBuilder({
      ...this["~effect"],
      meta: initialMeta,
    });
  }

  /**
   * Sets or overrides the initial route.
   * This option is typically relevant when integrating with OpenAPI.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing OpenAPI Routing Docs}
   * @see {@link https://orpc.dev/docs/openapi/input-output-structure OpenAPI Input/Output Structure Docs}
   */
  $route(
    initialRoute: Route,
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
      ...this["~effect"],
      route: initialRoute,
    });
  }

  /**
   * Sets or overrides the initial input schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#initial-configuration Initial Procedure Configuration Docs}
   */
  $input<U extends AnySchema>(
    initialInputSchema?: U,
  ): EffectBuilder<
    TInitialContext,
    TCurrentContext,
    U,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~effect"],
      inputSchema: initialInputSchema,
    });
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
    const newEffectErrorMap: MergedEffectErrorMap<TEffectErrorMap, U> = {
      ...this["~effect"].effectErrorMap,
      ...errors,
    };
    return new EffectBuilder({
      ...this["~effect"],
      errorMap: effectErrorMapToErrorMap(newEffectErrorMap),
      effectErrorMap: newEffectErrorMap,
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
      InferSchemaOutput<TInputSchema>,
      unknown,
      EffectErrorConstructorMap<TEffectErrorMap>,
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
      ...this["~effect"],
      middlewares: addMiddleware(this["~effect"].middlewares, mapped),
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
      ...this["~effect"],
      meta: mergeMeta(this["~effect"].meta, meta),
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
      ...this["~effect"],
      route: mergeRoute(this["~effect"].route, route),
    });
  }

  /**
   * Defines the input validation schema.
   *
   * @see {@link https://orpc.dev/docs/procedure#input-output-validation Input Validation Docs}
   */
  input<USchema extends AnySchema>(
    schema: USchema,
  ): EffectProcedureBuilderWithInput<
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
      ...this["~effect"],
      inputSchema: schema,
      inputValidationIndex:
        fallbackConfig(
          "initialInputValidationIndex",
          this["~effect"].config.initialInputValidationIndex,
        ) + this["~effect"].middlewares.length,
      // we cast to any because EffectProcedureBuilderWithInput is expecting
      // use() input type to be defined, and EffectBuilder types its use() input
      // to unknown to allow any middleware to be passed
      // ---
      // note: the original implentation of the builder also uses any for the same reason
    }) as any;
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
      ...this["~effect"],
      outputSchema: schema,
      outputValidationIndex:
        fallbackConfig(
          "initialOutputValidationIndex",
          this["~effect"].config.initialOutputValidationIndex,
        ) + this["~effect"].middlewares.length,
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
      ...this["~effect"],
      spanConfig: {
        name: spanName,
        captureStackTrace: addSpanStackTrace(),
      },
    });
  }

  handler<UFuncOutput>(
    handler: ProcedureHandler<
      TCurrentContext,
      InferSchemaOutput<TInputSchema>,
      UFuncOutput,
      EffectErrorMapToErrorMap<TEffectErrorMap>,
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
    return new EffectDecoratedProcedure({
      ...this["~effect"],
      handler,
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
      TInputSchema,
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
    const { runtime, spanConfig } = this["~effect"];
    // Capture stack trace at definition time for default tracing
    const defaultCaptureStackTrace = addSpanStackTrace();
    return new EffectDecoratedProcedure({
      ...this["~effect"],
      handler: async (opts) => {
        const effectOpts: ProcedureHandlerOptions<
          TCurrentContext,
          InferSchemaOutput<TInputSchema>,
          EffectErrorConstructorMap<TEffectErrorMap>,
          TMeta
        > = {
          context: opts.context,
          input: opts.input,
          path: opts.path,
          procedure: opts.procedure,
          signal: opts.signal,
          lastEventId: opts.lastEventId,
          errors: createEffectErrorConstructorMap(
            this["~effect"].effectErrorMap,
          ),
        };
        const spanName = spanConfig?.name ?? opts.path.join(".");
        const captureStackTrace =
          spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
        const resolver = Effect.fnUntraced(effectFn);
        const tracedEffect = Effect.withSpan(resolver(effectOpts), spanName, {
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

  /**
   * Prefixes all procedures in the router.
   * The provided prefix is post-appended to any existing router prefix.
   *
   * @note This option does not affect procedures that do not define a path in their route definition.
   *
   * @see {@link https://orpc.dev/docs/openapi/routing#route-prefixes OpenAPI Route Prefixes Docs}
   */
  prefix(
    prefix: HTTPPath,
  ): EffectRouterBuilder<
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~effect"],
      prefix: mergePrefix(this["~effect"].prefix, prefix),
    }) as any;
  }

  /**
   * Adds tags to all procedures in the router.
   * This helpful when you want to group procedures together in the OpenAPI specification.
   *
   * @see {@link https://orpc.dev/docs/openapi/openapi-specification#operation-metadata OpenAPI Operation Metadata Docs}
   */
  tag(
    ...tags: string[]
  ): EffectRouterBuilder<
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectBuilder({
      ...this["~effect"],
      tags: mergeTags(this["~effect"].tags, tags),
    }) as any;
  }

  /**
   * Applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  router<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    router: U,
  ): EnhancedEffectRouter<
    U,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  > {
    return enhanceEffectRouter(router, {
      ...this["~effect"],
    }) as any; // Type instantiation is excessively deep and possibly infinite
  }

  /**
   * Create a lazy router
   * And applies all of the previously defined options to the specified router.
   *
   * @see {@link https://orpc.dev/docs/router#extending-router Extending Router Docs}
   */
  lazy<U extends Router<ContractRouter<TMeta>, TCurrentContext>>(
    loader: () => Promise<{ default: U }>,
  ): EnhancedEffectRouter<
    Lazy<U>,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  > {
    return enhanceEffectRouter(lazy(loader), {
      ...this["~effect"],
    }) as any; // Type instantiation is excessively deep and possibly infinite
  }
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
  TBuilder extends AnyBuilderLike<
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  >,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder: TBuilder,
): EffectBuilder<
  InferBuilderInitialContext<TBuilder>,
  InferBuilderCurrentContext<TBuilder>,
  InferBuilderInputSchema<TBuilder>,
  InferBuilderOutputSchema<TBuilder>,
  InferBuilderErrorMap<TBuilder>,
  InferBuilderMeta<TBuilder>,
  TRequirementsProvided,
  TRuntimeError
>;

export function makeEffectORPC<TRequirementsProvided, TRuntimeError>(
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>,
  builder?: AnyBuilderLike,
): EffectBuilder<
  any,
  any,
  any,
  any,
  any,
  any,
  TRequirementsProvided,
  TRuntimeError
> {
  const resolvedBuilder = builder ?? emptyBuilder();
  return new EffectBuilder({
    ...resolvedBuilder["~orpc"],
    errorMap: effectErrorMapToErrorMap(resolvedBuilder["~orpc"].errorMap),
    effectErrorMap: resolvedBuilder["~orpc"].errorMap,
    runtime,
  });
}

function emptyBuilder(): AnyBuilderLike {
  return new Builder({
    config: {},
    route: {},
    meta: {},
    errorMap: {},
    inputValidationIndex: fallbackConfig("initialInputValidationIndex"),
    outputValidationIndex: fallbackConfig("initialOutputValidationIndex"),
    middlewares: [],
    dedupeLeadingMiddlewares: true,
  });
}
