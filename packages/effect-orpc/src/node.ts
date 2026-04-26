import { AsyncLocalStorage } from "node:async_hooks";

import type { Context } from "effect";
import { Effect } from "effect";

import {
  installServiceContextBridge,
  type ServiceContextBridge,
} from "./service-context-bridge";

const servicesStorage = new AsyncLocalStorage<Context.Context<any>>();

const bridge: ServiceContextBridge = {
  getCurrentServices: () => servicesStorage.getStore(),
};

installServiceContextBridge(bridge);

export function withFiberContext<T, R = never>(
  fn: () => Promise<T>,
): Effect.Effect<T, never, R> {
  return Effect.flatMap(Effect.context<R>(), (services) =>
    Effect.promise(() => servicesStorage.run(services, fn)),
  );
}
