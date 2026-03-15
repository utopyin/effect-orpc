import type { ClientContext } from "@orpc/client";
import type { AnySchema, Meta, Route } from "@orpc/contract";
import { mergeMeta, mergeRoute } from "@orpc/contract";
import type {
  AnyMiddleware,
  Context,
  CreateProcedureClientOptions,
  MapInputMiddleware,
  ProcedureDef,
} from "@orpc/server";
import {
  addMiddleware,
  createActionableClient,
  createProcedureClient,
  decorateMiddleware,
  Procedure,
} from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";

import { composeSurfaceProxy } from "./extension/compose-surfaces";
import {
  createNodeProxy,
  unhandled,
  type NodeProxyContext,
} from "./extension/create-node-proxy";
import { attachEffectState, type EffectProxyTarget } from "./extension/state";
import type { EffectErrorMap, MergedEffectErrorMap } from "./tagged-error";
import { effectErrorMapToErrorMap } from "./tagged-error";
import type { EffectErrorMapToErrorMap, EffectProcedureDef } from "./types";
import type { EffectDecoratedProcedureSurface } from "./types/effect-procedure-surface";

type AnyProcedureLike = Procedure<any, any, any, any, any, any>;

type EffectProcedureTarget = (
  | EffectProcedure<any, any, any, any, any, any, any, any>
  | EffectDecoratedProcedure<any, any, any, any, any, any, any, any>
) &
  EffectProxyTarget<AnyProcedureLike>;

const procedureVirtualDescriptors = {
  "~effect": { enumerable: true },
  actionable: { enumerable: false },
  callable: { enumerable: false },
  errors: { enumerable: false },
  meta: { enumerable: false },
  route: { enumerable: false },
  use: { enumerable: false },
} as const;

const baseProcedureVirtualKeys = ["~effect"] as const;
const decoratedProcedureVirtualKeys = [
  ...baseProcedureVirtualKeys,
  "errors",
  "meta",
  "route",
  "use",
  "callable",
  "actionable",
] as const;

function getOrCreateVirtualMethod<T>(
  context: NodeProxyContext<EffectProcedureTarget, AnyProcedureLike>,
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

function getEffectProcedureDef(
  context: NodeProxyContext<EffectProcedureTarget, AnyProcedureLike>,
): EffectProcedureDef<any, any, any, any, any, any, any, any> {
  return {
    ...context.upstream["~orpc"],
    effectErrorMap: context.state.effectErrorMap,
    runtime: context.state.runtime,
  };
}

function createEffectProcedureProxy(
  target: EffectProcedureTarget,
  decorated: boolean,
): EffectProcedureTarget {
  return createNodeProxy<EffectProcedureTarget, AnyProcedureLike>(target, {
    getVirtual(context, prop, receiver) {
      if (prop === "~effect") {
        return getEffectProcedureDef(context);
      }

      if (!decorated) {
        return unhandled();
      }

      const state = context.state;

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
              return new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                effectErrorMap: nextEffectErrorMap,
                errorMap: effectErrorMapToErrorMap(nextEffectErrorMap),
              });
            };
          });
        case "meta":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (meta: Meta) =>
              new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                meta: mergeMeta(getEffectProcedureDef(context).meta, meta),
              });
          });
        case "route":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (route: Route) =>
              new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                route: mergeRoute(getEffectProcedureDef(context).route, route),
              });
          });
        case "use":
          return getOrCreateVirtualMethod(context, prop, () => {
            return (
              middleware: AnyMiddleware,
              mapInput?: MapInputMiddleware<any, any>,
            ) => {
              const mapped = mapInput
                ? decorateMiddleware(middleware).mapInput(mapInput)
                : middleware;

              return new EffectDecoratedProcedure({
                ...getEffectProcedureDef(context),
                middlewares: addMiddleware(
                  getEffectProcedureDef(context).middlewares,
                  mapped,
                ),
              });
            };
          });
        case "callable":
          return <TClientContext extends ClientContext>(
            ...rest: MaybeOptionalOptions<
              CreateProcedureClientOptions<any, any, any, any, TClientContext>
            >
          ) => {
            const client = createProcedureClient(
              receiver as AnyProcedureLike,
              ...rest,
            );
            return composeSurfaceProxy(
              receiver as EffectDecoratedProcedure<
                any,
                any,
                any,
                any,
                any,
                any,
                any,
                any
              >,
              client,
            );
          };
        case "actionable":
          return (
            ...rest: MaybeOptionalOptions<
              CreateProcedureClientOptions<
                any,
                any,
                any,
                any,
                Record<never, never>
              >
            >
          ) => {
            const client = createProcedureClient(
              receiver as AnyProcedureLike,
              ...rest,
            );
            const action = createActionableClient(client);
            return composeSurfaceProxy(
              receiver as EffectDecoratedProcedure<
                any,
                any,
                any,
                any,
                any,
                any,
                any,
                any
              >,
              action,
            );
          };
        default:
          return unhandled();
      }
    },
    virtualDescriptors: procedureVirtualDescriptors,
    virtualKeys: decorated
      ? decoratedProcedureVirtualKeys
      : baseProcedureVirtualKeys,
  }) as EffectProcedureTarget;
}

/**
 * Effect-aware base procedure that carries the upstream procedure definition
 * together with Effect runtime and error metadata.
 */
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
    procedure?: AnyProcedureLike,
  ) {
    super(def);
    attachEffectState(
      this,
      (procedure ?? new Procedure(def)),
      {
        effectErrorMap: def.effectErrorMap,
        runtime: def.runtime,
      },
    );

    if (new.target === EffectProcedure) {
      return createEffectProcedureProxy(this, false);
    }
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
>
  extends EffectProcedure<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >
  implements
    EffectDecoratedProcedureSurface<
      TInitialContext,
      TCurrentContext,
      TInputSchema,
      TOutputSchema,
      TEffectErrorMap,
      TMeta,
      TRequirementsProvided,
      TRuntimeError
    >
{
  declare errors: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["errors"];
  declare meta: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["meta"];
  declare route: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["route"];
  declare use: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["use"];
  declare callable: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["callable"];
  declare actionable: EffectDecoratedProcedureSurface<
    TInitialContext,
    TCurrentContext,
    TInputSchema,
    TOutputSchema,
    TEffectErrorMap,
    TMeta,
    TRequirementsProvided,
    TRuntimeError
  >["actionable"];
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
    procedure?: AnyProcedureLike,
  ) {
    super(def, procedure);

    return createEffectProcedureProxy(this, true);
  }
}
