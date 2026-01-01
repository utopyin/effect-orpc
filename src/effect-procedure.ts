import type { ClientContext } from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  InferSchemaInput,
  InferSchemaOutput,
  Meta,
  Route,
} from "@orpc/contract";
import type {
  AnyMiddleware,
  Context,
  CreateProcedureClientOptions,
  MapInputMiddleware,
  MergedCurrentContext,
  MergedInitialContext,
  Middleware,
  ORPCErrorConstructorMap,
  ProcedureActionableClient,
  ProcedureClient,
  ProcedureDef,
} from "@orpc/server";
import type { IntersectPick, MaybeOptionalOptions } from "@orpc/shared";
import type { ManagedRuntime } from "effect";

import { mergeMeta, mergeRoute } from "@orpc/contract";
import {
  addMiddleware,
  createActionableClient,
  createProcedureClient,
  decorateMiddleware,
  Procedure,
} from "@orpc/server";

import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";

import { effectErrorMapToErrorMap } from "./tagged-error";

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
  ErrorMap,
  TMeta
> {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
}

/**
 * An Effect-native decorated procedure that preserves Effect error and requirements types.
 *
 * This class extends Procedure with additional type parameters for Effect-specific
 * type information, allowing full type inference of Effect errors and requirements.
 */
export class EffectDecoratedProcedure<
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TInputSchema extends AnySchema,
  TOutputSchema extends AnySchema,
  TEffectErrorMap extends EffectErrorMap,
  TMeta extends Meta,
  TRequirementsProvided,
  TRuntimeError,
> extends Procedure<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  ErrorMap,
  TMeta
> {
  declare "~orpc": EffectProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;

  constructor(
    def: EffectProcedureDef<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >,
  ) {
    super(def);
  }

  /**
   * Adds type-safe custom errors.
   * Supports both traditional oRPC error definitions and ORPCTaggedError classes.
   *
   * @see {@link https://orpc.dev/docs/error-handling#type%E2%80%90safe-error-handling Type-Safe Error Handling Docs}
   */
  errors<U extends EffectErrorMap>(
    errors: U,
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    MergedEffectErrorMap<TEffectErrorMap, U>,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    const newEffectErrorMap = { ...this["~orpc"].effectErrorMap, ...errors };
    return new EffectDecoratedProcedure({
      ...this["~orpc"],
      effectErrorMap: newEffectErrorMap,
      errorMap: effectErrorMapToErrorMap(newEffectErrorMap),
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
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectDecoratedProcedure({
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
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > {
    return new EffectDecoratedProcedure({
      ...this["~orpc"],
      route: mergeRoute(this["~orpc"].route, route),
    });
  }

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
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
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<ErrorMap>,
      TMeta
    >,
  ): EffectDecoratedProcedure<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;

  /**
   * Uses a middleware to modify the context or improve the pipeline.
   *
   * @info Supports both normal middleware and inline middleware implementations.
   * @info Pass second argument to map the input.
   * @note The current context must be satisfy middleware dependent-context
   * @see {@link https://orpc.dev/docs/middleware Middleware Docs}
   */
  use<
    UOutContext extends IntersectPick<TCurrentContext, UOutContext>,
    UInput,
    UInContext extends Context = TCurrentContext,
  >(
    middleware: Middleware<
      UInContext | TCurrentContext,
      UOutContext,
      UInput,
      InferSchemaInput<TOutputSchema>,
      ORPCErrorConstructorMap<ErrorMap>,
      TMeta
    >,
    mapInput: MapInputMiddleware<InferSchemaOutput<TInputSchema>, UInput>,
  ): EffectDecoratedProcedure<
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
  ): EffectDecoratedProcedure<any, any, any, any, any, any, any, any> {
    const mapped = mapInput
      ? decorateMiddleware(middleware).mapInput(mapInput)
      : middleware;

    return new EffectDecoratedProcedure({
      ...this["~orpc"],
      middlewares: addMiddleware(this["~orpc"].middlewares, mapped),
    });
  }

  /**
   * Make this procedure callable (works like a function while still being a procedure).
   *
   * @see {@link https://orpc.dev/docs/client/server-side Server-side Client Docs}
   */
  callable<TClientContext extends ClientContext>(
    ...rest: MaybeOptionalOptions<
      CreateProcedureClientOptions<
        TInitialContext,
        TOutputSchema,
        ErrorMap,
        TMeta,
        TClientContext
      >
    >
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > &
    ProcedureClient<TClientContext, TInputSchema, TOutputSchema, ErrorMap> {
    const client: ProcedureClient<
      TClientContext,
      TInputSchema,
      TOutputSchema,
      ErrorMap
    > = createProcedureClient(this, ...rest);

    return new Proxy(client, {
      get: (target, key) => {
        return Reflect.has(this, key)
          ? Reflect.get(this, key)
          : Reflect.get(target, key);
      },
      has: (target, key) => {
        return Reflect.has(this, key) || Reflect.has(target, key);
      },
    }) as any;
  }

  /**
   * Make this procedure compatible with server action.
   *
   * @see {@link https://orpc.dev/docs/server-action Server Action Docs}
   */
  actionable(
    ...rest: MaybeOptionalOptions<
      CreateProcedureClientOptions<
        TInitialContext,
        TOutputSchema,
        ErrorMap,
        TMeta,
        Record<never, never>
      >
    >
  ): EffectDecoratedProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  > &
    ProcedureActionableClient<TInputSchema, TOutputSchema, ErrorMap> {
    const action: ProcedureActionableClient<
      TInputSchema,
      TOutputSchema,
      ErrorMap
    > = createActionableClient(createProcedureClient(this, ...rest));

    return new Proxy(action, {
      get: (target, key) => {
        return Reflect.has(this, key)
          ? Reflect.get(this, key)
          : Reflect.get(target, key);
      },
      has: (target, key) => {
        return Reflect.has(this, key) || Reflect.has(target, key);
      },
    }) as any;
  }
}
