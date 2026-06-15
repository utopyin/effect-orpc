import { Context, Effect, Exit, Layer, ManagedRuntime } from "effect";

import { getCurrentServices } from "./service-context-bridge";

export type EffectRuntimeSource<TRequirementsProvided, TRuntimeError> =
  | ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>
  | Layer.Layer<TRequirementsProvided, TRuntimeError, never>;

export interface EffectRuntimeRunner<TRequirementsProvided, TRuntimeError> {
  readonly runtime?: ManagedRuntime.ManagedRuntime<
    TRequirementsProvided,
    TRuntimeError
  >;
  readonly runPromiseExit: <A, E>(
    effect: Effect.Effect<A, E, TRequirementsProvided>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Exit.Exit<A, E | TRuntimeError>>;
}

export function makeEffectRuntimeRunner<
  TRequirementsProvided = never,
  TRuntimeError = never,
>(
  source?: EffectRuntimeSource<TRequirementsProvided, TRuntimeError>,
): EffectRuntimeRunner<TRequirementsProvided, TRuntimeError> {
  if (source === undefined) {
    return {
      runPromiseExit: (effect, options) =>
        runPromiseExitWithCurrentServices(effect as any, options) as Promise<
          Exit.Exit<any, any>
        >,
    };
  }

  if (ManagedRuntime.isManagedRuntime(source)) {
    const runtime = source as ManagedRuntime.ManagedRuntime<
      TRequirementsProvided,
      TRuntimeError
    >;
    return {
      runtime,
      runPromiseExit: (effect, options) =>
        runManagedRuntimePromiseExit(runtime, effect, options),
    };
  }

  const layer = source as Layer.Layer<
    TRequirementsProvided,
    TRuntimeError,
    never
  >;
  return {
    runPromiseExit: (effect, options) =>
      Effect.runPromiseExit(
        provideLayerWithCurrentServices(effect as any, layer),
        { signal: options?.signal },
      ) as Promise<Exit.Exit<any, any>>,
  };
}

function runPromiseExitWithCurrentServices<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal },
): Promise<Exit.Exit<A, E>> {
  const parentServices = getCurrentServices();
  return parentServices
    ? (Effect.runPromiseExitWith(parentServices)(effect as any, {
        signal: options?.signal,
      }) as Promise<Exit.Exit<A, E>>)
    : (Effect.runPromiseExit(effect as any, {
        signal: options?.signal,
      }) as Promise<Exit.Exit<A, E>>);
}

async function runManagedRuntimePromiseExit<A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>,
  options?: { readonly signal?: AbortSignal },
): Promise<Exit.Exit<A, E | ER>> {
  const parentServices = getCurrentServices();
  return parentServices
    ? (Effect.runPromiseExitWith(
        Context.merge(await runtime.context(), parentServices),
      )(effect as any, { signal: options?.signal }) as Promise<
        Exit.Exit<A, E | ER>
      >)
    : runtime.runPromiseExit(effect, { signal: options?.signal });
}

function provideLayerWithCurrentServices<A, E, R, ROut, E2>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<ROut, E2, never>,
): Effect.Effect<A, E | E2, Exclude<R, ROut>> {
  const parentServices = getCurrentServices();
  if (!parentServices) {
    return Effect.provide(effect, layer);
  }

  return Effect.scoped(
    Effect.flatMap(Layer.build(layer), (layerContext) =>
      Effect.provide(
        effect as any,
        Context.merge(layerContext, parentServices),
      ),
    ),
  ) as any;
}
