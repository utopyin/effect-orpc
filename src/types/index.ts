import type { ORPCError, ORPCErrorCode } from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  Meta,
  Route,
  Schema,
} from "@orpc/contract";
import type {
  Builder,
  BuilderConfig,
  BuilderDef,
  BuilderWithMiddlewares,
  Context,
  EnhanceRouterOptions,
  ProcedureBuilder,
  ProcedureBuilderWithInput,
  ProcedureBuilderWithInputOutput,
  ProcedureBuilderWithOutput,
  ProcedureDef,
  ProcedureHandlerOptions,
  RouterBuilder,
} from "@orpc/server";
import type { Promisable } from "@orpc/shared";
import type { Effect, ManagedRuntime } from "effect";
import type { YieldWrap } from "effect/Utils";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  EffectErrorMapToUnion,
  ORPCTaggedErrorInstance,
} from "../tagged-error";

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
> extends EnhanceRouterOptions<EffectErrorMapToErrorMap<TEffectErrorMap>> {
  inputValidationIndex: number;
  outputValidationIndex: number;
  config: BuilderConfig;
  meta: TMeta;
  route: Route;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
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

export type NonEffectProcedureHandler<
  TCurrentContext extends Context,
  TInput,
  THandlerOutput,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
> = (
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Promisable<THandlerOutput>;

/**
 * Extended procedure definition that includes the Effect ManagedRuntime.
 */
export interface EffectProcedureDef<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends ProcedureDef<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  EffectErrorMapToErrorMap<TEffectErrorMap>,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
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
  opt: ProcedureHandlerOptions<
    TCurrentContext,
    TInput,
    EffectErrorConstructorMap<TEffectErrorMap>,
    TMeta
  >,
) => Generator<
  YieldWrap<
    Effect.Effect<
      any,
      | EffectErrorMapToUnion<TEffectErrorMap>
      | ORPCError<ORPCErrorCode, unknown>,
      TRequirementsProvided
    >
  >,
  THandlerOutput,
  never
>;

export type EffectErrorMapToErrorMap<T extends EffectErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends ErrorMapItem<AnySchema>
      ? T[K]
      : T[K] extends {
            new (
              ...args: any[]
            ): ORPCTaggedErrorInstance<any, any, infer TSchema>;
          }
        ? ErrorMapItem<TSchema>
        : never
    : never;
};

/**
 * Any oRPC builder-like object that has the `~orpc` definition property.
 * This includes Builder, BuilderWithMiddlewares, ProcedureBuilder, etc.
 */
export interface AnyBuilderLike<
  TInputSchema extends AnySchema = AnySchema,
  TOutputSchema extends AnySchema = AnySchema,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  "~orpc": BuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;
}

/**
 * Infers the initial context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderInitialContext<T> =
  T extends Builder<infer TInitial, any, any, any, any, any>
    ? TInitial
    : T extends BuilderWithMiddlewares<infer TInitial, any, any, any, any, any>
      ? TInitial
      : T extends ProcedureBuilder<infer TInitial, any, any, any, any, any>
        ? TInitial
        : T extends ProcedureBuilderWithInput<
              infer TInitial,
              any,
              any,
              any,
              any,
              any
            >
          ? TInitial
          : T extends ProcedureBuilderWithOutput<
                infer TInitial,
                any,
                any,
                any,
                any,
                any
              >
            ? TInitial
            : T extends ProcedureBuilderWithInputOutput<
                  infer TInitial,
                  any,
                  any,
                  any,
                  any,
                  any
                >
              ? TInitial
              : T extends RouterBuilder<infer TInitial, any, any, any>
                ? TInitial
                : Context;

/**
 * Infers the current context from an oRPC builder type.
 * Since context is a phantom type parameter not present in `~orpc`,
 * we need to use conditional type inference on the known builder types.
 */
export type InferBuilderCurrentContext<T> =
  T extends Builder<any, infer TCurrent, any, any, any, any>
    ? TCurrent
    : T extends BuilderWithMiddlewares<any, infer TCurrent, any, any, any, any>
      ? TCurrent
      : T extends ProcedureBuilder<any, infer TCurrent, any, any, any, any>
        ? TCurrent
        : T extends ProcedureBuilderWithInput<
              any,
              infer TCurrent,
              any,
              any,
              any,
              any
            >
          ? TCurrent
          : T extends ProcedureBuilderWithOutput<
                any,
                infer TCurrent,
                any,
                any,
                any,
                any
              >
            ? TCurrent
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  infer TCurrent,
                  any,
                  any,
                  any,
                  any
                >
              ? TCurrent
              : T extends RouterBuilder<any, infer TCurrent, any, any>
                ? TCurrent
                : Context;

/**
 * Infers the input schema from an oRPC builder type.
 */
export type InferBuilderInputSchema<T> =
  T extends Builder<any, any, infer TInput, any, any, any>
    ? TInput
    : T extends BuilderWithMiddlewares<any, any, infer TInput, any, any, any>
      ? TInput
      : T extends ProcedureBuilder<any, any, infer TInput, any, any, any>
        ? TInput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              infer TInput,
              any,
              any,
              any
            >
          ? TInput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                infer TInput,
                any,
                any,
                any
              >
            ? TInput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  infer TInput,
                  any,
                  any,
                  any
                >
              ? TInput
              : Schema<unknown, unknown>;

/**
 * Infers the output schema from an oRPC builder type.
 */
export type InferBuilderOutputSchema<T> =
  T extends Builder<any, any, any, infer TOutput, any, any>
    ? TOutput
    : T extends BuilderWithMiddlewares<any, any, any, infer TOutput, any, any>
      ? TOutput
      : T extends ProcedureBuilder<any, any, any, infer TOutput, any, any>
        ? TOutput
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              infer TOutput,
              any,
              any
            >
          ? TOutput
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                infer TOutput,
                any,
                any
              >
            ? TOutput
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  infer TOutput,
                  any,
                  any
                >
              ? TOutput
              : Schema<unknown, unknown>;

/**
 * Infers the error map from an oRPC builder type.
 */
export type InferBuilderErrorMap<T> =
  T extends Builder<any, any, any, any, infer TErrorMap, any>
    ? TErrorMap
    : T extends BuilderWithMiddlewares<any, any, any, any, infer TErrorMap, any>
      ? TErrorMap
      : T extends ProcedureBuilder<any, any, any, any, infer TErrorMap, any>
        ? TErrorMap
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              infer TErrorMap,
              any
            >
          ? TErrorMap
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                infer TErrorMap,
                any
              >
            ? TErrorMap
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  infer TErrorMap,
                  any
                >
              ? TErrorMap
              : T extends RouterBuilder<any, any, infer TErrorMap, any>
                ? TErrorMap
                : ErrorMap;

/**
 * Infers the meta from an oRPC builder type.
 */
export type InferBuilderMeta<T> =
  T extends Builder<any, any, any, any, any, infer TMeta>
    ? TMeta
    : T extends BuilderWithMiddlewares<any, any, any, any, any, infer TMeta>
      ? TMeta
      : T extends ProcedureBuilder<any, any, any, any, any, infer TMeta>
        ? TMeta
        : T extends ProcedureBuilderWithInput<
              any,
              any,
              any,
              any,
              any,
              infer TMeta
            >
          ? TMeta
          : T extends ProcedureBuilderWithOutput<
                any,
                any,
                any,
                any,
                any,
                infer TMeta
              >
            ? TMeta
            : T extends ProcedureBuilderWithInputOutput<
                  any,
                  any,
                  any,
                  any,
                  any,
                  infer TMeta
                >
              ? TMeta
              : T extends RouterBuilder<any, any, any, infer TMeta>
                ? TMeta
                : Meta;

export * from "./variants";
