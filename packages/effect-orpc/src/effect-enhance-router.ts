import {
  enhanceRoute,
  mergePrefix,
  type EnhanceRouteOptions,
} from "@orpc/contract";
import {
  createAccessibleLazyRouter,
  getLazyMeta,
  isLazy,
  isProcedure,
  lazy,
  mergeMiddlewares,
  unlazy,
  type AnyMiddleware,
  type AnyRouter,
  type Context,
  type Lazyable,
} from "@orpc/server";
import type { ManagedRuntime } from "effect/ManagedRuntime";

import { EffectProcedure } from "./effect-procedure";
import { getEffectErrorMap, unwrapEffectUpstream } from "./extension/state";
import { effectErrorMapToErrorMap, type EffectErrorMap } from "./tagged-error";
import type { EffectErrorMapToErrorMap, EnhancedEffectRouter } from "./types";

interface EnhanceEffectRouterOptions<
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
> extends EnhanceRouteOptions {
  middlewares: readonly AnyMiddleware[];
  errorMap: TEffectErrorMap;
  dedupeLeadingMiddlewares: boolean;
  runtime: ManagedRuntime<TRequirementsProvided, TRuntimeError>;
}

const routerCaches = new WeakMap<object, Map<PropertyKey, unknown>>();

function getRouterMethodCache(target: object): Map<PropertyKey, unknown> {
  const existing = routerCaches.get(target);
  if (existing !== undefined) {
    return existing;
  }

  const created = new Map<PropertyKey, unknown>();
  routerCaches.set(target, created);
  return created;
}

function createBoundRouterMethod(
  target: object,
  prop: PropertyKey,
  value: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  const cache = getRouterMethodCache(target);
  if (cache.has(prop)) {
    return cache.get(prop) as (...args: unknown[]) => unknown;
  }

  const wrapped = (...args: unknown[]) => Reflect.apply(value, target, args);
  cache.set(prop, wrapped);
  return wrapped;
}

function wrapRouterObject<
  T extends Record<string, any>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
>(
  router: T,
  options: EnhanceEffectRouterOptions<
    TEffectErrorMap,
    TRequirementsProvided,
    TRuntimeError
  >,
): EnhancedEffectRouter<T, TInitialContext, TCurrentContext, TEffectErrorMap> {
  return new Proxy(router, {
    get(currentTarget, prop, receiver) {
      if (
        typeof prop === "string" &&
        Reflect.has(currentTarget, prop) &&
        currentTarget[prop] !== undefined
      ) {
        return enhanceEffectRouter(currentTarget[prop], options);
      }

      const sourceValue = Reflect.get(currentTarget, prop, receiver);

      if (typeof sourceValue === "function") {
        return createBoundRouterMethod(
          currentTarget,
          prop,
          sourceValue as (...args: unknown[]) => unknown,
        );
      }

      return sourceValue;
    },
    has(currentTarget, prop) {
      return Reflect.has(currentTarget, prop);
    },
    ownKeys(currentTarget) {
      return Reflect.ownKeys(currentTarget);
    },
    getOwnPropertyDescriptor(currentTarget, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(currentTarget, prop);

      if (descriptor === undefined) {
        return undefined;
      }

      if ("value" in descriptor && typeof descriptor.value === "function") {
        return {
          ...descriptor,
          value: createBoundRouterMethod(
            currentTarget,
            prop,
            descriptor.value as (...args: unknown[]) => unknown,
          ),
        };
      }

      return descriptor;
    },
  }) as unknown as EnhancedEffectRouter<
    T,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  >;
}

export function enhanceEffectRouter<
  T extends Lazyable<AnyRouter>,
  TInitialContext extends Context,
  TCurrentContext extends Context,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
>(
  router: T,
  options: EnhanceEffectRouterOptions<
    TEffectErrorMap,
    TRequirementsProvided,
    TRuntimeError
  >,
): EnhancedEffectRouter<T, TInitialContext, TCurrentContext, TEffectErrorMap> {
  if (isLazy(router)) {
    const laziedMeta = getLazyMeta(router);
    const enhancedPrefix = laziedMeta?.prefix
      ? mergePrefix(options.prefix, laziedMeta.prefix)
      : options.prefix;

    const enhanced = lazy(
      async () => {
        const { default: unlaziedRouter } = await unlazy(router);
        const wrappedRouter = enhanceEffectRouter(unlaziedRouter, options);
        return unlazy(wrappedRouter);
      },
      {
        ...laziedMeta,
        prefix: enhancedPrefix,
      },
    );

    return createAccessibleLazyRouter(
      enhanced,
    ) as unknown as EnhancedEffectRouter<
      T,
      TInitialContext,
      TCurrentContext,
      TEffectErrorMap
    >;
  }

  if (isProcedure(router)) {
    const source = unwrapEffectUpstream(router);
    const sourceEffectErrorMap = getEffectErrorMap(router as any);
    const middlewares = mergeMiddlewares(
      options.middlewares,
      source["~orpc"].middlewares,
      { dedupeLeading: options.dedupeLeadingMiddlewares },
    );
    const newMiddlewareAdded =
      middlewares.length - source["~orpc"].middlewares.length;
    const effectErrorMap = {
      ...options.errorMap,
      ...sourceEffectErrorMap,
    };
    const errorMap: EffectErrorMapToErrorMap<typeof effectErrorMap> =
      effectErrorMapToErrorMap(effectErrorMap);

    return new EffectProcedure(
      {
        ...source["~orpc"],
        route: enhanceRoute(source["~orpc"].route, options),
        effectErrorMap,
        errorMap: errorMap as EffectErrorMapToErrorMap<typeof effectErrorMap>,
        middlewares,
        inputValidationIndex:
          source["~orpc"].inputValidationIndex + newMiddlewareAdded,
        outputValidationIndex:
          source["~orpc"].outputValidationIndex + newMiddlewareAdded,
        runtime: options.runtime,
      },
      source,
    ) as unknown as EnhancedEffectRouter<
      T,
      TInitialContext,
      TCurrentContext,
      TEffectErrorMap
    >;
  }

  return wrapRouterObject(
    router as Record<string, any>,
    options,
  ) as unknown as EnhancedEffectRouter<
    T,
    TInitialContext,
    TCurrentContext,
    TEffectErrorMap
  >;
}
