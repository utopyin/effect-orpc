import type { FiberRefs } from "effect";

import { Effect } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  installFiberContextBridge,
  type FiberContextBridge,
} from "./fiber-context-bridge";

const fiberRefsStorage = new AsyncLocalStorage<FiberRefs.FiberRefs>();

const bridge: FiberContextBridge = {
  getCurrentFiberRefs: () => fiberRefsStorage.getStore(),
};

installFiberContextBridge(bridge);

export function withFiberContext<T>(fn: () => Promise<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
    Effect.promise(() => fiberRefsStorage.run(fiberRefs, fn)),
  );
}
