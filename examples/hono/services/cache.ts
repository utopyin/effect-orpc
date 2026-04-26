import { Effect, Layer, Context } from "effect";

import { DatabaseService } from "./database";

export class CacheService extends Context.Service<
  CacheService,
  {
    readonly get: (key: string) => Effect.Effect<unknown>;
    readonly set: (key: string, value: unknown) => Effect.Effect<boolean>;
  }
>()("CacheService", {
  make: Effect.gen(function* () {
    const db = yield* DatabaseService;
    const cache = new Map<string, unknown>();

    return {
      get: (key: string) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(`Cache lookup: ${key}`);

          if (cache.has(key)) {
            yield* Effect.logInfo(`Cache HIT: ${key}`);
            return cache.get(key);
          }

          yield* Effect.logInfo(`Cache MISS: ${key}, fetching from DB`);
          const result =
            yield* db.query`SELECT * FROM cache WHERE key = '${key}'`;
          cache.set(key, result);
          return result;
        }).pipe(
          Effect.annotateLogs("service", "CacheService"),
          Effect.withSpan("CacheService.get"),
        ),
      set: (key: string, value: unknown) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(`Cache set: ${key}`);
          cache.set(key, value);
          yield* db.insert("cache", { key, value });
          return true;
        }).pipe(
          Effect.annotateLogs("service", "CacheService"),
          Effect.withSpan("CacheService.set"),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DatabaseService.layer),
  );
}
