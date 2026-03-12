import { Effect, Layer, ServiceMap } from "effect";

export class DatabaseService extends ServiceMap.Service<
  DatabaseService,
  {
    readonly query: (
      sql: TemplateStringsArray,
      ...args: unknown[]
    ) => Effect.Effect<{
      rows: Array<{ id: number; data: string }>;
      rowCount: number;
    }>;
    readonly insert: (
      table: string,
      data: unknown,
    ) => Effect.Effect<{ id: number; success: boolean }>;
  }
>()("DatabaseService") {
  static readonly layer = Layer.succeed(this, {
    query: (sql: TemplateStringsArray, ..._args: unknown[]) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(`Executing SQL: ${sql}`);
        yield* Effect.sleep("10 millis");
        return { rows: [{ id: 1, data: "result" }], rowCount: 1 };
      }).pipe(
        Effect.annotateLogs("service", "DatabaseService"),
        Effect.withSpan("DatabaseService.query"),
      ),
    insert: (table: string, _data: unknown) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(`Inserting into ${table}`);
        yield* Effect.sleep("15 millis");
        return { id: Math.floor(Math.random() * 1000), success: true };
      }).pipe(
        Effect.annotateLogs("service", "DatabaseService"),
        Effect.withSpan("DatabaseService.insert"),
      ),
  });
}
