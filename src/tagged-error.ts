import type {
  ORPCErrorCode,
  ORPCErrorJSON,
  ORPCErrorOptions,
} from "@orpc/client";
import type {
  AnySchema,
  ErrorMap,
  ErrorMapItem,
  InferSchemaOutput,
} from "@orpc/contract";
import type { ORPCErrorConstructorMap } from "@orpc/server";
import type { MaybeOptionalOptions } from "@orpc/shared";
import type { Pipeable } from "effect";
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

import type { EffectErrorMapToErrorMap } from "./types";

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
  TSchema extends AnySchema = AnySchema,
>
  extends Cause.YieldableError, Pipeable.Pipeable {
  readonly _tag: TTag;
  readonly code: TCode;
  readonly status: number;
  readonly schema: TSchema;
  readonly data: InferSchemaOutput<TSchema>;
  readonly defined: boolean;
  readonly [ORPCErrorSymbol]: ORPCError<TCode, InferSchemaOutput<TSchema>>;

  toJSON(): ORPCErrorJSON<TCode, InferSchemaOutput<TSchema>> & { _tag: TTag };
  toORPCError(): ORPCError<TCode, InferSchemaOutput<TSchema>>;
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
  TSchema extends AnySchema = AnySchema,
> {
  readonly _tag: TTag;
  readonly code: TCode;
  new (
    ...args: MaybeOptionalOptions<
      ORPCTaggedErrorOptions<InferSchemaOutput<TSchema>>
    >
  ): ORPCTaggedErrorInstance<TTag, TCode, TSchema>;
}

/**
 * Type helper to infer the ORPCError type from an ORPCTaggedError
 */
export type InferORPCError<T> =
  T extends ORPCTaggedErrorInstance<string, infer TCode, infer TSchema>
    ? ORPCError<TCode, InferSchemaOutput<TSchema>>
    : never;

/**
 * Any ORPCTaggedErrorClass
 * Uses `...args: any[]` for the constructor to accept any tagged error class,
 * regardless of whether TData requires options to be provided.
 */
export type AnyORPCTaggedErrorClass = {
  readonly _tag: string;
  readonly code: ORPCErrorCode;
  new (
    ...args: any[]
  ): ORPCTaggedErrorInstance<string, ORPCErrorCode, AnySchema>;
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
): value is ORPCTaggedErrorInstance<string, ORPCErrorCode, AnySchema> {
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
/**
 * Checks if a character is an uppercase letter (A-Z)
 */
type IsUpperLetter<C extends string> =
  C extends Uppercase<C>
    ? C extends Lowercase<C>
      ? false // Not a letter (number, special char)
      : true
    : false;

/**
 * Checks if a character is a lowercase letter (a-z)
 */
type IsLowerLetter<C extends string> =
  C extends Lowercase<C>
    ? C extends Uppercase<C>
      ? false // Not a letter (number, special char)
      : true
    : false;

/**
 * Converts PascalCase or camelCase to CONSTANT_CASE.
 * Handles consecutive uppercase letters correctly.
 *
 * @example
 * type T1 = ToConstantCase<"ABCCode">; // "ABC_CODE"
 * type T2 = ToConstantCase<"UserCode">; // "USER_CODE"
 * type T3 = ToConstantCase<"XMLHttpRequest">; // "XML_HTTP_REQUEST"
 */
type ToConstantCase<
  S extends string,
  Acc extends string = "",
  PrevChar extends string = "",
  InUpperSequence extends boolean = false,
> = S extends `${infer Head}${infer Tail}`
  ? IsUpperLetter<Head> extends true
    ? Acc extends ""
      ? // First character - no underscore
        ToConstantCase<Tail, Head, Head, false>
      : PrevChar extends ""
        ? // Shouldn't happen, but handle gracefully
          ToConstantCase<Tail, Head, Head, false>
        : IsUpperLetter<PrevChar> extends true
          ? // We're in an uppercase sequence
            Tail extends `${infer Next}${infer _}`
            ? IsLowerLetter<Next> extends true
              ? // Next char is lowercase, so Head starts a new word - insert underscore
                ToConstantCase<Tail, `${Acc}_${Head}`, Head, false>
              : // Next char is uppercase or non-letter - continue sequence
                ToConstantCase<Tail, `${Acc}${Head}`, Head, true>
            : // Tail is empty - just append
              ToConstantCase<Tail, `${Acc}${Head}`, Head, true>
          : // Transition from lowercase to uppercase - insert underscore
            ToConstantCase<Tail, `${Acc}_${Head}`, Head, false>
    : IsLowerLetter<Head> extends true
      ? InUpperSequence extends true
        ? // End of uppercase sequence (2+) - insert underscore before lowercase
          ToConstantCase<Tail, `${Acc}_${Uppercase<Head>}`, Head, false>
        : // Single uppercase or no uppercase - no underscore
          ToConstantCase<Tail, `${Acc}${Uppercase<Head>}`, Head, false>
      : // Non-letter character - reset sequence
        ToConstantCase<Tail, `${Acc}${Head}`, Head, false>
  : Acc;

/**
 * Converts a tag name to an error code in CONSTANT_CASE.
 */
export type TagToCode<TTag extends string> = ToConstantCase<TTag>;

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
interface ORPCTaggedErrorFactory<TSchema extends AnySchema = AnySchema> {
  // Overload 1: tag only (code defaults to CONSTANT_CASE of tag)
  <TTag extends string>(
    tag: TTag,
  ): ORPCTaggedErrorClass<TTag, TagToCode<TTag>, TSchema>;

  // Overload 2: tag + options (code defaults to CONSTANT_CASE of tag)
  <TTag extends string>(
    tag: TTag,
    options: { status?: number; message?: string },
  ): ORPCTaggedErrorClass<TTag, TagToCode<TTag>, TSchema>;

  // Overload 3: tag + explicit code
  <TTag extends string, TCode extends ORPCErrorCode>(
    tag: TTag,
    code: TCode,
    defaultOptions?: { status?: number; message?: string },
  ): ORPCTaggedErrorClass<TTag, TCode, TSchema>;
}

export function ORPCTaggedError<TSchema extends AnySchema = AnySchema>(
  schema?: TSchema,
) {
  const factory = <TTag extends string, TCode extends ORPCErrorCode>(
    tag: TTag,
    codeOrOptions?: TCode | { status?: number; message?: string },
    defaultOptions?: { status?: number; message?: string },
  ): ORPCTaggedErrorClass<TTag, TCode, TSchema> => {
    // Determine if second arg is code or options
    const isCodeProvided = typeof codeOrOptions === "string";
    const code = (
      isCodeProvided ? codeOrOptions : toConstantCase(tag)
    ) as TCode;
    const options = isCodeProvided ? defaultOptions : codeOrOptions;

    const defaultStatus = options?.status;
    const defaultMessage = options?.message;

    // Use Effect's TaggedError as the base - this handles all Effect internals
    // (YieldableError, type symbols, Symbol.iterator, pipe(), etc.)
    const BaseTaggedError = Data.TaggedError(tag) as unknown as new (args: {
      message?: string;
      cause?: unknown;
      code: TCode;
      status: number;
      data: InferSchemaOutput<TSchema>;
      defined: boolean;
    }) => Cause.YieldableError & {
      readonly _tag: TTag;
      readonly code: TCode;
      readonly status: number;
      readonly data: InferSchemaOutput<TSchema>;
      readonly defined: boolean;
    };

    class ORPCTaggedErrorBase extends BaseTaggedError {
      static readonly schema = schema;
      static readonly _tag = tag;
      static readonly code = code;

      readonly [ORPCErrorSymbol]: ORPCError<TCode, InferSchemaOutput<TSchema>>;

      constructor(
        ...rest: MaybeOptionalOptions<
          ORPCTaggedErrorOptions<InferSchemaOutput<TSchema>>
        >
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

        const data = opts.data as InferSchemaOutput<TSchema>;
        // Pass to Effect's TaggedError - it spreads these onto the instance
        super({
          message: finalMessage,
          cause: opts.cause,
          code,
          status: finalStatus,
          data,
          defined: opts.defined ?? true,
        });

        // Create the underlying ORPCError for interop
        this[ORPCErrorSymbol] = new ORPCError<
          TCode,
          InferSchemaOutput<TSchema>
        >(code, {
          status: finalStatus,
          message: finalMessage,
          data,
          defined: this.defined,
          cause: opts.cause,
        });
      }

      /**
       * Converts this error to a plain ORPCError.
       * Useful when you need to return from an oRPC handler.
       */
      toORPCError(): ORPCError<TCode, TSchema> {
        return this[ORPCErrorSymbol];
      }

      override toJSON(): ORPCErrorJSON<TCode, TSchema> & { _tag: TTag } {
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

  return factory as ORPCTaggedErrorFactory<TSchema>;
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
export function toORPCError<
  TCode extends ORPCErrorCode,
  TSchema extends AnySchema = AnySchema,
>(
  error: ORPCTaggedErrorInstance<string, TCode, TSchema>,
): ORPCError<TCode, InferSchemaOutput<TSchema>> {
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

export type ORPCTaggedErrorClassToErrorMapItem<T> =
  T extends ORPCTaggedErrorClass<any, any, infer TData>
    ? {
        status?: number;
        message?: string;
        data?: TData;
      }
    : never;

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
> = Omit<T1, keyof T2> & T2;

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
 * Constructor map for EffectErrorMap - provides typed error constructors for handlers.
 */
export type EffectErrorConstructorMap<T extends EffectErrorMap> =
  ORPCErrorConstructorMap<EffectErrorMapToErrorMap<T>>;

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
): EffectErrorMapToErrorMap<T> {
  const result: ErrorMap = {};

  if (!errorMap) {
    return result as ErrorMap & EffectErrorMapToErrorMap<T>;
  }

  for (const [code, ClassOrErrorItem] of Object.entries(errorMap)) {
    if (!ClassOrErrorItem) {
      continue;
    }

    if (isORPCTaggedErrorClass(ClassOrErrorItem)) {
      const classInstance = new ClassOrErrorItem();
      // For tagged errors, we create a minimal entry
      // The actual validation will be handled by the tagged error class
      result[classInstance.code] = {
        status: classInstance.status,
        message: classInstance.message,
        data: classInstance.schema,
      };
    } else {
      result[code] = ClassOrErrorItem;
    }
  }

  return result as ErrorMap & EffectErrorMapToErrorMap<T>;
}

export function mergeAnyErrorMaps<
  T1 extends EffectErrorMap,
  T2 extends EffectErrorMap,
>(map1: T1, map2: T2): EffectErrorMapToErrorMap<T1 & T2> {
  return {
    ...map1,
    ...map2,
  } as EffectErrorMapToErrorMap<T1 & T2>;
}
