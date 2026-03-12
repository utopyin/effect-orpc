import { serve } from "bun";
import { Effect, pipe } from "effect";

import { createApp } from "./app";
import { runtime } from "./runtime";

const port = Number(process.env.PORT ?? "3000");

const app = createApp();

const server = serve({
  fetch: app.fetch,
  port,
});

await runtime.runPromise(
  pipe(
    Effect.logInfo(`Server started on http://localhost:${port}`),
    Effect.annotateLogs("service", "backend-service"),
  ),
);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
