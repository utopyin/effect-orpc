import { ORPCError } from "@orpc/contract";
import type {
  Context as ORPCContext,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { ManagedRuntime } from "effect";
import { Cause, Effect, Exit, Result, Context } from "effect";

import { getCurrentServices } from "./service-context-bridge";
import type { EffectErrorConstructorMap, EffectErrorMap } from "./tagged-error";
import {
  createEffectErrorConstructorMap,
  isORPCTaggedError,
} from "./tagged-error";
import type { EffectProcedureHandler, EffectSpanConfig } from "./types";

export function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  if (Cause.hasFails(cause)) {
    const reason = Cause.findFail(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR");
    }

    const error = reason.success.error;
    if (isORPCTaggedError(error)) {
      return error.toORPCError();
    }
    if (error instanceof ORPCError) {
      return error;
    }

    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: error,
    });
  }

  if (Cause.hasDies(cause)) {
    const reason = Cause.findDie(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`Died by unknown reason`),
      });
    }
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: reason.success.defect,
    });
  }

  if (Cause.hasInterrupts(cause)) {
    const reason = Cause.findInterrupt(cause);
    if (Result.isFailure(reason)) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`Unknown fiber got interrupted`),
      });
    }
    return new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error(`${reason.success.fiberId} got interrupted`),
    });
  }

  return new ORPCError("INTERNAL_SERVER_ERROR");
}

export function createEffectProcedureHandler<
  TCurrentContext extends ORPCContext,
  TInput,
  TOutput,
  TEffectErrorMap extends EffectErrorMap,
  TRequirementsProvided,
  TRuntimeError,
  TMeta,
>(options: {
  runtime: ManagedRuntime.ManagedRuntime<TRequirementsProvided, TRuntimeError>;
  effectErrorMap: TEffectErrorMap;
  effectFn: EffectProcedureHandler<
    TCurrentContext,
    TInput,
    TOutput,
    TEffectErrorMap,
    TRequirementsProvided,
    any
  >;
  spanConfig?: EffectSpanConfig;
  defaultCaptureStackTrace: () => string | undefined;
}): ProcedureHandler<
  TCurrentContext,
  TInput,
  TOutput,
  any,
  TMeta & Record<never, never>
> {
  const {
    runtime,
    effectErrorMap,
    effectFn,
    spanConfig,
    defaultCaptureStackTrace,
  } = options;

  return async (opts) => {
    const effectOpts: ProcedureHandlerOptions<
      TCurrentContext,
      TInput,
      EffectErrorConstructorMap<TEffectErrorMap>,
      TMeta & Record<never, never>
    > = {
      context: opts.context,
      input: opts.input,
      path: opts.path,
      procedure: opts.procedure,
      signal: opts.signal,
      lastEventId: opts.lastEventId,
      errors: createEffectErrorConstructorMap(effectErrorMap),
    };

    const spanName = spanConfig?.name ?? opts.path.join(".");
    const captureStackTrace =
      spanConfig?.captureStackTrace ?? defaultCaptureStackTrace;
    const resolver = Effect.fnUntraced(effectFn as any);
    const tracedEffect = Effect.withSpan(resolver(effectOpts), spanName, {
      captureStackTrace,
    });

    const parentServices = getCurrentServices();
    const exit = parentServices
      ? await Effect.runPromiseExitWith(
          Context.merge(await runtime.context(), parentServices),
        )(tracedEffect, {
          signal: opts.signal,
        })
      : await runtime.runPromiseExit(tracedEffect, {
          signal: opts.signal,
        });

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause);
    }

    return exit.value as TOutput;
  };
}
