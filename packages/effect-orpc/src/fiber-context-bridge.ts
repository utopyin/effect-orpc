import type { FiberRefs } from "effect";

export interface FiberContextBridge {
  readonly getCurrentFiberRefs: () => FiberRefs.FiberRefs | undefined;
  readonly runWithFiberRefs?: <T>(
    fiberRefs: FiberRefs.FiberRefs,
    fn: () => Promise<T>,
  ) => Promise<T>;
}

let bridge: FiberContextBridge | undefined;

export function installFiberContextBridge(
  nextBridge: FiberContextBridge | undefined,
): void {
  bridge = nextBridge;
}

export function getCurrentFiberRefs(): FiberRefs.FiberRefs | undefined {
  return bridge?.getCurrentFiberRefs();
}

export function runWithFiberRefs<T>(
  fiberRefs: FiberRefs.FiberRefs,
  fn: () => Promise<T>,
): Promise<T> {
  return bridge?.runWithFiberRefs
    ? bridge.runWithFiberRefs(fiberRefs, fn)
    : fn();
}
