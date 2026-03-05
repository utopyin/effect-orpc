import type { ManagedRuntime } from "effect/ManagedRuntime";

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

import type { EffectErrorMapToErrorMap, EnhancedEffectRouter } from "./types";

import { EffectProcedure } from "./effect-procedure";
import { effectErrorMapToErrorMap, type EffectErrorMap } from "./tagged-error";

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
      ? mergePrefix(options.prefix, laziedMeta?.prefix)
      : options.prefix;

    const enhanced = lazy(
      async () => {
        const { default: unlaziedRouter } = await unlazy(router);
        const enhanced = enhanceEffectRouter(unlaziedRouter, options);
        return unlazy(enhanced);
      },
      {
        ...laziedMeta,
        prefix: enhancedPrefix,
      },
    );

    const accessible = createAccessibleLazyRouter(enhanced);

    return accessible as any;
  }

  if (isProcedure(router)) {
    const newMiddlewares = mergeMiddlewares(
      options.middlewares,
      router["~orpc"].middlewares,
      { dedupeLeading: options.dedupeLeadingMiddlewares },
    );
    const newMiddlewareAdded =
      newMiddlewares.length - router["~orpc"].middlewares.length;

    const effectErrorMap = {
      ...options.errorMap,
      ...router["~orpc"].errorMap,
    };
    const errorMap: EffectErrorMapToErrorMap<typeof effectErrorMap> =
      effectErrorMapToErrorMap(effectErrorMap);
    const enhanced = new EffectProcedure({
      ...router["~orpc"],
      route: enhanceRoute(router["~orpc"].route, options),
      effectErrorMap,
      errorMap: errorMap as EffectErrorMapToErrorMap<typeof effectErrorMap>,
      middlewares: newMiddlewares,
      inputValidationIndex:
        router["~orpc"].inputValidationIndex + newMiddlewareAdded,
      outputValidationIndex:
        router["~orpc"].outputValidationIndex + newMiddlewareAdded,
      runtime: options.runtime,
    });

    return enhanced as any;
  }

  const enhanced = {} as Record<string, any>;

  for (const key in router) {
    enhanced[key] = enhanceEffectRouter(router[key]!, options);
  }

  return enhanced as any;
}
