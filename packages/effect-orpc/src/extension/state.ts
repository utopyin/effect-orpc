import type { ManagedRuntime } from "effect";

import type { EffectErrorMap } from "../tagged-error";
import type { EffectSpanConfig } from "../types";

export interface EffectExtensionState<
  TRequirementsProvided = any,
  TRuntimeError = any,
> {
  /**
   * Extended error map that supports both traditional oRPC errors and ORPCTaggedError classes.
   * @see {@link EffectErrorMap}
   */
  effectErrorMap: EffectErrorMap;
  /**
   * The Effect ManagedRuntime that provides services for Effect procedures.
   * @see {@link ManagedRuntime.ManagedRuntime}
   */
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  /**
   * Configuration for Effect span tracing.
   * @see {@link EffectSpanConfig}
   */
  spanConfig?: EffectSpanConfig;
}

export interface EffectInternals<TUpstream extends object = object> {
  upstream: TUpstream;
  state: EffectExtensionState;
  methodCache: Map<PropertyKey, unknown>;
}

export const effectInternalsSymbol = Symbol("effect-orpc/internals");

export interface EffectProxyTarget<TUpstream extends object = object> {
  [effectInternalsSymbol]: EffectInternals<TUpstream>;
}

export function attachEffectState<
  TTarget extends object,
  TUpstream extends object,
>(
  target: TTarget,
  upstream: TUpstream,
  state: EffectExtensionState,
): asserts target is TTarget & EffectProxyTarget<TUpstream> {
  Object.defineProperties(target, {
    [effectInternalsSymbol]: {
      configurable: true,
      value: {
        methodCache: new Map<PropertyKey, unknown>(),
        state,
        upstream,
      } satisfies EffectInternals<TUpstream>,
    },
  });
}

export function getEffectInternals<TUpstream extends object>(
  target: EffectProxyTarget<TUpstream>,
): EffectInternals<TUpstream> {
  return target[effectInternalsSymbol];
}

export function getEffectUpstream<TUpstream extends object>(
  target: EffectProxyTarget<TUpstream>,
): TUpstream {
  return getEffectInternals(target).upstream;
}

export function getEffectState(
  target: EffectProxyTarget,
): EffectExtensionState {
  return getEffectInternals(target).state;
}

export function getEffectMethodCache(
  target: EffectProxyTarget,
): Map<PropertyKey, unknown> {
  return getEffectInternals(target).methodCache;
}

export function hasEffectState(value: unknown): value is EffectProxyTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    effectInternalsSymbol in (value as object)
  );
}

export function getEffectErrorMap(value: {
  "~effect"?: { effectErrorMap: EffectErrorMap };
  "~orpc": { errorMap: EffectErrorMap };
}): EffectErrorMap {
  return value["~effect"]?.effectErrorMap ?? value["~orpc"].errorMap;
}

export function unwrapEffectUpstream<T extends object>(value: T): T {
  return hasEffectState(value) ? (getEffectUpstream(value) as T) : value;
}
