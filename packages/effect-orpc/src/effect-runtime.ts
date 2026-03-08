import { ORPCError } from "@orpc/contract";
import type {
  Context,
  ProcedureHandler,
  ProcedureHandlerOptions,
} from "@orpc/server";
import type { ManagedRuntime } from "effect";
import { Cause, Effect, Exit, FiberRefs } from "effect";

import { getCurrentFiberRefs } from "./fiber-context-bridge";
import type { EffectErrorConstructorMap, EffectErrorMap } from "./tagged-error";
import {
  createEffectErrorConstructorMap,
  isORPCTaggedError,
} from "./tagged-error";
import type { EffectProcedureHandler, EffectSpanConfig } from "./types";

export function toORPCErrorFromCause(
  cause: Cause.Cause<unknown>,
): ORPCError<string, unknown> {
  return Cause.match(cause, {
    onDie(defect) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: defect,
      });
    },
    onFail(error) {
      if (isORPCTaggedError(error)) {
        return error.toORPCError();
      }
      if (error instanceof ORPCError) {
        return error;
      }
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: error,
      });
    },
    onInterrupt(fiberId) {
      return new ORPCError("INTERNAL_SERVER_ERROR", {
        cause: new Error(`${fiberId} Interrupted`),
      });
    },
    onSequential(left) {
      return left;
    },
    onEmpty: new ORPCError("INTERNAL_SERVER_ERROR", {
      cause: new Error("Unknown error"),
    }),
    onParallel(left) {
      return left;
    },
  });
}

export function createEffectProcedureHandler<
  TCurrentContext extends Context,
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
    const parentFiberRefs = getCurrentFiberRefs();
    const effectWithRefs = parentFiberRefs
      ? Effect.fiberIdWith((fiberId) =>
          Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
            Effect.setFiberRefs(
              FiberRefs.joinAs(fiberRefs, fiberId, parentFiberRefs),
            ).pipe(Effect.andThen(tracedEffect)),
          ),
        )
      : tracedEffect;
    const exit = await runtime.runPromiseExit(effectWithRefs, {
      signal: opts.signal,
    });

    if (Exit.isFailure(exit)) {
      throw toORPCErrorFromCause(exit.cause);
    }

    return exit.value as TOutput;
  };
}
