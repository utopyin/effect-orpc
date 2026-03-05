import type { FiberRefs } from "effect";

export interface FiberContextBridge {
  readonly getCurrentFiberRefs: () => FiberRefs.FiberRefs | undefined;
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
