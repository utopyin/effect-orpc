import type {
  ORPCErrorCode,
  ORPCErrorJSON,
  ORPCErrorOptions,
} from "@orpc/client";
import type { AnySchema, ErrorMap, ErrorMapItem } from "@orpc/contract";
import type { ORPCErrorConstructorMapItemOptions } from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";
import type { Pipeable, Types } from "effect";
import type * as Cause from "effect/Cause";
import type * as Effect from "effect/Effect";

import {
  fallbackORPCErrorMessage,
  fallbackORPCErrorStatus,
  isORPCErrorStatus,
  ORPCError,
} from "@orpc/client";
import { resolveMaybeOptionalOptions } from "@orpc/shared";
import * as Data from "effect/Data";

/**
 * Symbol to access the underlying ORPCError instance
 */
export const ORPCErrorSymbol: unique symbol = Symbol.for(
  "@orpc/effect/ORPCTaggedError",
);

/**
 * Instance type for ORPCTaggedError that combines YieldableError with ORPCError properties
 */
export interface ORPCTaggedErrorInstance<
  TTag extends string,
  TCode extends ORPCErrorCode,
  TData,
>
  extends Cause.YieldableError, Pipeable.Pipeable {
  readonly _tag: TTag;
  readonly code: TCode;
  readonly status: number;
  readonly data: TData;
  readonly defined: boolean;
  readonly [ORPCErrorSymbol]: ORPCError<TCode, TData>;

  toJSON(): ORPCErrorJSON<TCode, TData> & { _tag: TTag };
  toORPCError(): ORPCError<TCode, TData>;
  commit(): Effect.Effect<never, this, never>;
}

/**
 * Options for creating an ORPCTaggedError
 */
export type ORPCTaggedErrorOptions<TData> = Omit<
  ORPCErrorOptions<TData>,
  "defined"
> & { defined?: boolean };

/**
 * Constructor type for ORPCTaggedError classes
 */
export interface ORPCTaggedErrorClass<
  TTag extends string,
  TCode extends ORPCErrorCode,
  TData,
> {
  readonly _tag: TTag;
  readonly code: TCode;
  new (
    ...args: MaybeOptionalOptions<ORPCTaggedErrorOptions<TData>>
  ): ORPCTaggedErrorInstance<TTag, TCode, TData>;
}

/**
 * Type helper to infer the ORPCError type from an ORPCTaggedError
 */
export type InferORPCError<T> =
  T extends ORPCTaggedErrorInstance<string, infer TCode, infer TData>
    ? ORPCError<TCode, TData>
    : never;

/**
 * Any ORPCTaggedErrorClass
 * Uses `...args: any[]` for the constructor to accept any tagged error class,
 * regardless of whether TData requires options to be provided.
 */
export type AnyORPCTaggedErrorClass = {
  readonly _tag: string;
  readonly code: ORPCErrorCode;
  new (...args: any[]): ORPCTaggedErrorInstance<string, ORPCErrorCode, any>;
};

/**
 * Check if a value is an ORPCTaggedErrorClass (constructor)
 */
export function isORPCTaggedErrorClass(
  value: unknown,
): value is AnyORPCTaggedErrorClass {
  return (
    typeof value === "function" &&
    "_tag" in value &&
    "code" in value &&
    typeof value._tag === "string" &&
    typeof value.code === "string"
  );
}

/**
 * Check if a value is an ORPCTaggedError instance
 */
export function isORPCTaggedError(
  value: unknown,
): value is ORPCTaggedErrorInstance<string, ORPCErrorCode, unknown> {
  return (
    typeof value === "object" && value !== null && ORPCErrorSymbol in value
  );
}

/**
 * Converts a PascalCase or camelCase string to CONSTANT_CASE.
 * e.g., "UserNotFoundError" -> "USER_NOT_FOUND_ERROR"
 */
function toConstantCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

// Type-level conversion: split on capital letters and join with underscore
type SplitOnCapital<
  S extends string,
  Acc extends string = "",
> = S extends `${infer Head}${infer Tail}`
  ? Head extends Uppercase<Head>
    ? Head extends Lowercase<Head>
      ? SplitOnCapital<Tail, `${Acc}${Head}`>
      : Acc extends ""
        ? SplitOnCapital<Tail, Head>
        : `${Acc}_${SplitOnCapital<Tail, Head>}`
    : SplitOnCapital<Tail, `${Acc}${Uppercase<Head>}`>
  : Acc;

/**
 * Converts a tag name to an error code in CONSTANT_CASE.
 */
export type TagToCode<TTag extends string> = SplitOnCapital<TTag>;

/**
 * Creates a tagged error class that combines Effect's YieldableError with ORPCError.
 *
 * This allows you to create errors that:
 * - Can be yielded in Effect generators (`yield* myError`)
 * - Have all ORPCError properties (code, status, data, defined)
 * - Can be converted to a plain ORPCError for oRPC handlers
 *
 * The returned factory function takes:
 * - `tag` - The unique tag for this error type (used for discriminated unions)
 * - `codeOrOptions` - Optional ORPC error code or options. If omitted, code defaults to CONSTANT_CASE of tag
 * - `defaultOptions` - Optional default options for status and message (when code is provided)
 *
 * @example
 * ```ts
 * import { ORPCTaggedError } from '@orpc/effect'
 * import { Effect } from 'effect'
 *
 * // Define a custom error (code defaults to 'USER_NOT_FOUND_ERROR')
 * class UserNotFoundError extends ORPCTaggedError<UserNotFoundError>()('UserNotFoundError') {}
 *
 * // With explicit code
 * class NotFoundError extends ORPCTaggedError<NotFoundError>()('NotFoundError', 'NOT_FOUND') {}
 *
 * // Use in an Effect
 * const getUser = (id: string) => Effect.gen(function* () {
 *   const user = yield* findUser(id)
 *   if (!user) {
 *     return yield* new UserNotFoundError({ data: { userId: id } })
 *   }
 *   return user
 * })
 *
 * // With custom data type
 * class ValidationError extends ORPCTaggedError<ValidationError, { fields: string[] }>()('ValidationError', 'BAD_REQUEST') {}
 *
 * // With options only (code defaults to 'VALIDATION_ERROR')
 * class ValidationError2 extends ORPCTaggedError<ValidationError2, { fields: string[] }>()(
 *   'ValidationError2',
 *   { message: 'Validation failed' }
 * ) {}
 * ```
 */
/**
 * Return type for the factory function with overloads
 */
interface ORPCTaggedErrorFactory<Self, TData> {
  // Overload 1: tag only (code defaults to CONSTANT_CASE of tag)
  <TTag extends string>(
    tag: TTag,
  ): Types.Equals<Self, unknown> extends true
    ? `Missing \`Self\` generic - use \`class MyError extends ORPCTaggedError<MyError>()(tag) {}\``
    : ORPCTaggedErrorClass<TTag, TagToCode<TTag>, TData>;

  // Overload 2: tag + options (code defaults to CONSTANT_CASE of tag)
  <TTag extends string>(
    tag: TTag,
    options: { status?: number; message?: string },
  ): Types.Equals<Self, unknown> extends true
    ? `Missing \`Self\` generic - use \`class MyError extends ORPCTaggedError<MyError>()(tag, options) {}\``
    : ORPCTaggedErrorClass<TTag, TagToCode<TTag>, TData>;

  // Overload 3: tag + explicit code
  <TTag extends string, TCode extends ORPCErrorCode>(
    tag: TTag,
    code: TCode,
    defaultOptions?: { status?: number; message?: string },
  ): Types.Equals<Self, unknown> extends true
    ? `Missing \`Self\` generic - use \`class MyError extends ORPCTaggedError<MyError>()(tag, code) {}\``
    : ORPCTaggedErrorClass<TTag, TCode, TData>;
}

export function ORPCTaggedError<
  Self,
  TData = undefined,
>(): ORPCTaggedErrorFactory<Self, TData> {
  const factory = <TTag extends string, TCode extends ORPCErrorCode>(
    tag: TTag,
    codeOrOptions?: TCode | { status?: number; message?: string },
    defaultOptions?: { status?: number; message?: string },
  ): ORPCTaggedErrorClass<TTag, TCode, TData> => {
    // Determine if second arg is code or options
    const isCodeProvided = typeof codeOrOptions === "string";
    const code = (
      isCodeProvided ? codeOrOptions : toConstantCase(tag)
    ) as TCode;
    const options = isCodeProvided ? defaultOptions : codeOrOptions;

    const defaultStatus = options?.status;
    const defaultMessage = options?.message;

    // Use Effect's TaggedError as the base - this handles all Effect internals
    // (YieldableError, type symbols, commit(), Symbol.iterator, pipe(), etc.)
    const BaseTaggedError = Data.TaggedError(tag) as unknown as new (args: {
      message?: string;
      cause?: unknown;
      code: TCode;
      status: number;
      data: TData;
      defined: boolean;
    }) => Cause.YieldableError & {
      readonly _tag: TTag;
      readonly code: TCode;
      readonly status: number;
      readonly data: TData;
      readonly defined: boolean;
    };

    class ORPCTaggedErrorBase extends BaseTaggedError {
      static readonly _tag = tag;
      static readonly code = code;

      readonly [ORPCErrorSymbol]: ORPCError<TCode, TData>;

      constructor(
        ...rest: MaybeOptionalOptions<ORPCTaggedErrorOptions<TData>>
      ) {
        const opts = resolveMaybeOptionalOptions(rest);
        const status = opts.status ?? defaultStatus;
        const inputMessage = opts.message ?? defaultMessage;

        if (status !== undefined && !isORPCErrorStatus(status)) {
          throw new globalThis.Error(
            "[ORPCTaggedError] Invalid error status code.",
          );
        }

        const finalStatus = fallbackORPCErrorStatus(code, status);
        const finalMessage = fallbackORPCErrorMessage(code, inputMessage);

        // Pass to Effect's TaggedError - it spreads these onto the instance
        super({
          message: finalMessage,
          cause: opts.cause,
          code,
          status: finalStatus,
          data: opts.data as TData,
          defined: opts.defined ?? true,
        });

        // Create the underlying ORPCError for interop
        this[ORPCErrorSymbol] = new ORPCError(code, {
          status: finalStatus,
          message: finalMessage,
          data: opts.data as TData,
          defined: this.defined,
          cause: opts.cause,
        });
      }

      /**
       * Converts this error to a plain ORPCError.
       * Useful when you need to return from an oRPC handler.
       */
      toORPCError(): ORPCError<TCode, TData> {
        return this[ORPCErrorSymbol];
      }

      override toJSON(): ORPCErrorJSON<TCode, TData> & { _tag: TTag } {
        return {
          _tag: this._tag,
          defined: this.defined,
          code: this.code,
          status: this.status,
          message: this.message,
          data: this.data,
        };
      }
    }

    return ORPCTaggedErrorBase as any;
  };

  return factory as ORPCTaggedErrorFactory<Self, TData>;
}

/**
 * Converts an ORPCTaggedError to a plain ORPCError.
 * Useful in handlers that need to throw ORPCError.
 *
 * @example
 * ```ts
 * const handler = effectOs.effect(function* () {
 *   const result = yield* someOperation.pipe(
 *     Effect.catchTag('UserNotFoundError', (e) =>
 *       Effect.fail(toORPCError(e))
 *     )
 *   )
 *   return result
 * })
 * ```
 */
export function toORPCError<TCode extends ORPCErrorCode, TData>(
  error: ORPCTaggedErrorInstance<string, TCode, TData>,
): ORPCError<TCode, TData> {
  return error[ORPCErrorSymbol];
}

// ============================================================================
// Extended Error Map Types for Effect
// ============================================================================

/**
 * An item in the EffectErrorMap - can be either a traditional ErrorMapItem or an ORPCTaggedErrorClass
 */
export type EffectErrorMapItem =
  | ErrorMapItem<AnySchema>
  | AnyORPCTaggedErrorClass;

/**
 * Extended error map that supports both traditional oRPC errors and ORPCTaggedError classes.
 *
 * @example
 * ```ts
 * const errorMap = {
 *   // Traditional format
 *   BAD_REQUEST: { status: 400, message: 'Bad request' },
 *
 *   // Tagged error class reference
 *   USER_NOT_FOUND: UserNotFoundError,
 * } satisfies EffectErrorMap
 * ```
 */
export type EffectErrorMap = {
  [key in ORPCErrorCode]?: EffectErrorMapItem;
};

/**
 * Merges two EffectErrorMaps, with the second map taking precedence.
 */
export type MergedEffectErrorMap<
  T1 extends EffectErrorMap,
  T2 extends EffectErrorMap,
> = T1 & T2;

/**
 * Extracts the instance type from an EffectErrorMapItem
 */
export type EffectErrorMapItemToInstance<
  TCode extends ORPCErrorCode,
  T extends EffectErrorMapItem,
> = T extends AnyORPCTaggedErrorClass
  ? InstanceType<T>
  : T extends { data?: infer TData }
    ? ORPCError<TCode, TData>
    : ORPCError<TCode, unknown>;

/**
 * Converts an EffectErrorMap to a union of error instances.
 */
export type EffectErrorMapToUnion<T extends EffectErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends EffectErrorMapItem
      ? EffectErrorMapItemToInstance<K, T[K]>
      : never
    : never;
}[keyof T];

/**
 * Type for the error constructors available in Effect handlers.
 * For tagged errors, it's the class constructor itself.
 * For traditional errors, it's a function that creates ORPCError.
 */
export type EffectErrorConstructorMapItem<
  TCode extends ORPCErrorCode,
  T extends EffectErrorMapItem,
> =
  T extends ORPCTaggedErrorClass<infer _TTag, TCode, infer TData>
    ? (
        ...args: MaybeOptionalOptions<ORPCTaggedErrorOptions<TData>>
      ) => ORPCTaggedErrorInstance<_TTag, TCode, TData>
    : T extends { data?: infer TData }
      ? (
          ...args: MaybeOptionalOptions<
            ORPCErrorConstructorMapItemOptions<TData>
          >
        ) => ORPCError<TCode, TData>
      : (
          ...args: MaybeOptionalOptions<
            ORPCErrorConstructorMapItemOptions<unknown>
          >
        ) => ORPCError<TCode, unknown>;

/**
 * Constructor map for EffectErrorMap - provides typed error constructors for handlers.
 */
export type EffectErrorConstructorMap<T extends EffectErrorMap> = {
  [K in keyof T]: K extends ORPCErrorCode
    ? T[K] extends EffectErrorMapItem
      ? EffectErrorConstructorMapItem<K, T[K]>
      : never
    : never;
};

/**
 * Creates an error constructor map from an EffectErrorMap.
 * Tagged error classes are passed through directly.
 * Traditional error items become ORPCError factory functions.
 */
export function createEffectErrorConstructorMap<T extends EffectErrorMap>(
  errors: T | undefined,
): EffectErrorConstructorMap<T> {
  const target = errors ?? ({} as T);
  const proxy = new Proxy(target, {
    get(proxyTarget, code) {
      if (typeof code !== "string") {
        return Reflect.get(proxyTarget, code);
      }

      const config = target[code];

      // If it's a tagged error class, create a class constructor function
      if (isORPCTaggedErrorClass(config)) {
        return (
          ...opts: MaybeOptionalOptions<ORPCTaggedErrorOptions<unknown>>
        ) => new config(...opts);
      }

      // Otherwise, create a factory function for ORPCError
      return (
        ...rest: MaybeOptionalOptions<
          Omit<ORPCErrorOptions<unknown>, "defined" | "status">
        >
      ) => {
        const options = resolveMaybeOptionalOptions(rest);
        return new ORPCError(code, {
          defined: Boolean(config),
          status: config?.status,
          message: options.message ?? config?.message,
          data: options.data,
          cause: options.cause,
        });
      };
    },
  });

  return proxy as EffectErrorConstructorMap<T>;
}

/**
 * Converts an EffectErrorMap to a standard oRPC ErrorMap for interop.
 * Tagged error classes are converted to their equivalent ErrorMapItem format.
 */
export function effectErrorMapToErrorMap<T extends EffectErrorMap>(
  errorMap: T | undefined,
): ErrorMap {
  const result: ErrorMap = {};

  if (!errorMap) {
    return result;
  }

  for (const [code, ClassOrErrorItem] of Object.entries(errorMap)) {
    if (!ClassOrErrorItem) {
      continue;
    }

    if (isORPCTaggedErrorClass(ClassOrErrorItem)) {
      const error = new ClassOrErrorItem().toORPCError();

      // For tagged errors, we create a minimal entry
      // The actual validation will be handled by the tagged error class
      result[code] = {
        status: error.status,
        message: error.message,
        data: error.data,
      };
    } else {
      result[code] = ClassOrErrorItem;
    }
  }

  return result;
}
