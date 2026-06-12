import { AsyncLocalStorage } from "node:async_hooks";

import type { FiberRefs } from "effect";
import { Effect } from "effect";

import {
  installFiberContextBridge,
  type FiberContextBridge,
} from "./fiber-context-bridge";

const fiberRefsStorage = new AsyncLocalStorage<FiberRefs.FiberRefs>();

const bridge: FiberContextBridge = {
  getCurrentFiberRefs: () => fiberRefsStorage.getStore(),
  runWithFiberRefs: (fiberRefs, fn) => fiberRefsStorage.run(fiberRefs, fn),
};

installFiberContextBridge(bridge);

export function withFiberContext<T>(fn: () => Promise<T>): Effect.Effect<T> {
  return Effect.flatMap(Effect.getFiberRefs, (fiberRefs) =>
    Effect.promise(() => bridge.runWithFiberRefs!(fiberRefs, fn)),
  );
}
