import { Effect, Exit, FiberRefs, Layer, ManagedRuntime } from "effect";

import { getCurrentFiberRefs } from "./fiber-context-bridge";

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
        Effect.runPromiseExit(withParentFiberRefs(effect as any), {
          signal: options?.signal,
        }) as Promise<Exit.Exit<any, any>>,
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
        runtime.runPromiseExit(withParentFiberRefs(effect), {
          signal: options?.signal,
        }),
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
        withParentFiberRefs(Effect.provide(effect as any, layer)),
        { signal: options?.signal },
      ) as Promise<Exit.Exit<any, any>>,
  };
}

function withParentFiberRefs<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  const parentFiberRefs = getCurrentFiberRefs();
  return parentFiberRefs
    ? Effect.fiberIdWith((fiberId) =>
        Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
          Effect.setFiberRefs(
            FiberRefs.joinAs(fiberRefs, fiberId, parentFiberRefs),
          ).pipe(Effect.andThen(effect)),
        ),
      )
    : effect;
}
