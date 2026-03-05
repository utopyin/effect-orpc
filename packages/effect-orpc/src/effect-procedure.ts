import type { ClientContext } from "@orpc/client";
import type {
  AnySchema,
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
  ProcedureActionableClient,
  ProcedureClient,
  ProcedureDef,
} from "@orpc/server";
import type { IntersectPick, MaybeOptionalOptions } from "@orpc/shared";

import { mergeMeta, mergeRoute } from "@orpc/contract";
import {
  addMiddleware,
  createActionableClient,
  createProcedureClient,
  decorateMiddleware,
  Procedure,
} from "@orpc/server";

import type {
  EffectErrorConstructorMap,
  EffectErrorMap,
  MergedEffectErrorMap,
} from "./tagged-error";
import type { EffectErrorMapToErrorMap, EffectProcedureDef } from "./types";

import { effectErrorMapToErrorMap } from "./tagged-error";

export class EffectProcedure<
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
  EffectErrorMapToErrorMap<TEffectErrorMap>,
  TMeta
> {
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  declare "~effect": EffectProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  /**
   * This property holds the defined options.
   */
  declare "~orpc": ProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
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
    this["~effect"] = def;
  }
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
> extends EffectProcedure<
  TInitialContext,
  TCurrentContext,
  TInputSchema,
  TOutputSchema,
  TEffectErrorMap,
  TMeta,
  TRequirementsProvided,
  TRuntimeError
> {
  /**
   * This property holds the defined options and the effect-specific properties.
   */
  declare "~effect": EffectProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >;
  declare "~orpc": ProcedureDef<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    EffectErrorMapToErrorMap<TEffectErrorMap>,
    TMeta
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
    this["~effect"] = def;
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
    const newEffectErrorMap: MergedEffectErrorMap<TEffectErrorMap, U> = {
      ...this["~effect"].effectErrorMap,
      ...errors,
    };
    return new EffectDecoratedProcedure({
      ...this["~effect"],
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
      ...this["~effect"],
      route: mergeRoute(this["~effect"].route, route),
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
      EffectErrorConstructorMap<TEffectErrorMap>,
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
      EffectErrorConstructorMap<TEffectErrorMap>,
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
      ...this["~effect"],
      middlewares: addMiddleware(this["~effect"].middlewares, mapped),
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
        EffectErrorMapToErrorMap<TEffectErrorMap>,
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
    ProcedureClient<
      TClientContext,
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
    > {
    const client: ProcedureClient<
      TClientContext,
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
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
        EffectErrorMapToErrorMap<TEffectErrorMap>,
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
    ProcedureActionableClient<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
    > {
    const action: ProcedureActionableClient<
      TInputSchema,
      TOutputSchema,
      EffectErrorMapToErrorMap<TEffectErrorMap>
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
