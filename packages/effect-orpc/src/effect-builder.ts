import type {
  AnySchema,
  ContractRouter,
  ErrorMap,
  Meta,
  Schema,
} from "@orpc/contract";
import type { Context, Router } from "@orpc/server";
import { Builder, fallbackConfig, lazy } from "@orpc/server";
import type { ManagedRuntime } from "effect";

import { enhanceEffectRouter } from "./effect-enhance-router";
import { EffectDecoratedProcedure } from "./effect-procedure";
import { createEffectProcedureHandler } from "./effect-runtime";
import {
  createNodeProxy,
  unhandled,
  type NodeProxyContext,
} from "./extension/create-node-proxy";
import {
  attachEffectState,
  getEffectErrorMap,
  unwrapEffectUpstream,
  type EffectProxyTarget,
} from "./extension/state";
import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type {
  AnyBuilderLike,
  EffectBuilderDef,
  InferBuilderCurrentContext,
  InferBuilderErrorMap,
  InferBuilderInitialContext,
  InferBuilderInputSchema,
  InferBuilderMeta,
  InferBuilderOutputSchema,
} from "./types";
import type { EffectBuilderSurface } from "./types/effect-builder-surface";

const builderVirtualDescriptors = {
  "~effect": { enumerable: true },
  effect: { enumerable: false },
  errors: { enumerable: false },
  handler: { enumerable: false },
  lazy: { enumerable: false },
  router: { enumerable: false },
  traced: { enumerable: false },
} as const;

const builderVirtualKeys = [
  "~effect",
  "errors",
  "effect",
  "traced",
  "handler",
  "router",
  "lazy",
] as const;

type EffectBuilderTarget = EffectBuilder<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
> &
  EffectProxyTarget<AnyBuilderLike>;

function isBuilderLike(value: unknown): value is AnyBuilderLike {
  return typeof value === "object" && value !== null && "~orpc" in value;
}

function getOrCreateVirtualMethod<T>(
  context: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>,
  prop: PropertyKey,
  factory: () => T,
): T {
  const cache = context.methodCache;
  if (cache.has(prop)) {
    return cache.get(prop) as T;
  }

  const value = factory();
  cache.set(prop, value);
  return value;
}

function getEffectBuilderDef(
  context: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>,
): EffectBuilderDef<any, any, any, any, any, any> {
  return {
    ...context.upstream["~orpc"],
    effectErrorMap: context.state.effectErrorMap,
    runtime: context.state.runtime,
    spanConfig: context.state.spanConfig,
  };
}

function wrapBuilderLike(
  builder: AnyBuilderLike,
  state: NodeProxyContext<EffectBuilderTarget, AnyBuilderLike>["state"],
): EffectBuilder<any, any, any, any, any, any, any, any> {
  return new EffectBuilder(
    {
      ...builder["~orpc"],
      effectErrorMap: state.effectErrorMap,
      runtime: state.runtime,
      spanConfig: state.spanConfig,
    },
    unwrapEffectUpstream(builder),
  );
}

function createEffectBuilderProxy(
  target: EffectBuilderTarget,
): EffectBuilderTarget {
  return createNodeProxy<EffectBuilderTarget, AnyBuilderLike>(target, {
    getVirtual(context, prop) {
      const effectDef = getEffectBuilderDef(context);
      if (prop === "~effect") {
        return getEffectBuilderDef(context);
      }

      const { upstream: source, state } = context;

      switch (prop) {
        case "errors":
          return getOrCreateVirtualMethod(context, prop, () => {
            return <U extends EffectErrorMap>(errors: U) => {
              const nextEffectErrorMap: MergedEffectErrorMap<
                typeof state.effectErrorMap,
                U
              > = {
                ...state.effectErrorMap,
                ...errors,
              };
              const nextBuilder: AnyBuilderLike = Reflect.apply(
                Reflect.get(source, "errors", source),
                source,
                [effectErrorMapToErrorMap(errors)],
              );

              return wrapBuilderLike(nextBuilder, {
                ...state,
                effectErrorMap: nextEffectErrorMap,
              });
            };
          });
        case "effect":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              effectFn: Parameters<
                EffectBuilderSurface<
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any
                >["effect"]
              >[0],
            ) => {
              const defaultCaptureStackTrace = addSpanStackTrace();
              return new EffectDecoratedProcedure({
                ...effectDef,
                handler: async (opts) => {
                  return createEffectProcedureHandler({
                    defaultCaptureStackTrace,
                    effectErrorMap: state.effectErrorMap,
                    effectFn,
                    runtime: state.runtime,
                    spanConfig: state.spanConfig,
                  })(opts as any);
                },
              });
            };
          });
        case "traced":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (spanName: string) =>
              wrapBuilderLike(source, {
                ...state,
                spanConfig: {
                  captureStackTrace: addSpanStackTrace(),
                  name: spanName,
                },
              });
          });
        case "handler":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              handler: Parameters<
                EffectBuilderSurface<
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any,
                  any
                >["handler"]
              >[0],
            ) =>
              new EffectDecoratedProcedure({
                ...effectDef,
                handler,
              });
          });
        case "router":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (router: Router<ContractRouter<any>, any>) =>
              enhanceEffectRouter(router, effectDef) as any;
          });
        case "lazy":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              loader: () => Promise<{
                default: Router<ContractRouter<any>, any>;
              }>,
            ) => enhanceEffectRouter(lazy(loader), effectDef) as any;
          });
        default:
          return unhandled();
      }
    },
    virtualDescriptors: builderVirtualDescriptors,
    virtualKeys: builderVirtualKeys,
    wrapResult(context, _prop, result) {
      if (!isBuilderLike(result)) {
        return result;
      }

      return wrapBuilderLike(result, context.state);
    },
  });
}

/**
 * Captures the stack trace at the call site for better error reporting in spans.
 * This is called at procedure definition time to capture where the procedure was defined.
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
> implements EffectBuilderSurface<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  TEffectErrorMap,
  TMeta,
  TRequirementsProvided,
  TRuntimeError
> {
  declare $config: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$config"];
  declare $context: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$context"];
  declare $meta: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$meta"];
  declare $route: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$route"];
  declare $input: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["$input"];
  declare "~effect": EffectBuilderDef<
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  declare "~orpc": EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["~orpc"];
  declare middleware: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["middleware"];
  declare errors: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["errors"];
  declare use: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["use"];
  declare meta: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["meta"];
  declare route: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["route"];
  declare input: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["input"];
  declare output: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["output"];
  declare traced: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["traced"];
  declare handler: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["handler"];
  declare effect: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["effect"];
  declare prefix: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["prefix"];
  declare tag: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["tag"];
  declare router: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["router"];
  declare lazy: EffectBuilderSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["lazy"];

  constructor(
    def: EffectBuilderDef<
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
    builder?: AnyBuilderLike,
  ) {
    const { runtime, spanConfig, effectErrorMap, ...orpcDef } = def;

    attachEffectState(this, builder ?? new Builder(orpcDef), {
      effectErrorMap,
      runtime,
      spanConfig,
    });

    return createEffectBuilderProxy(this);
  }
}

/**
 * Creates an Effect-aware procedure builder with the specified ManagedRuntime.
 * Uses the default builder shape from `@orpc/server`.
 *
 * @param runtime - The ManagedRuntime that provides services for Effect procedures
 * @returns An EffectBuilder instance for creating Effect-native procedures
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
 * @param builder - The oRPC Builder instance to wrap
 * @returns An EffectBuilder instance that extends the original builder with Effect support
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
  return new EffectBuilder(
    {
      ...resolvedBuilder["~orpc"],
      effectErrorMap: getEffectErrorMap(resolvedBuilder),
      errorMap: effectErrorMapToErrorMap(getEffectErrorMap(resolvedBuilder)),
      runtime,
    },
    unwrapEffectUpstream(resolvedBuilder),
  );
}

function emptyBuilder(): AnyBuilderLike {
  return new Builder({
    config: {},
    dedupeLeadingMiddlewares: true,
    errorMap: {},
    inputValidationIndex: fallbackConfig("initialInputValidationIndex"),
    meta: {},
    middlewares: [],
    outputValidationIndex: fallbackConfig("initialOutputValidationIndex"),
    route: {},
  });
}
