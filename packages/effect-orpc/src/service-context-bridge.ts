import type { Context } from "effect";

export interface ServiceContextBridge {
  readonly getCurrentServices: () => Context.Context<any> | undefined;
}

let bridge: ServiceContextBridge | undefined;

export function installServiceContextBridge(
  nextBridge: ServiceContextBridge | undefined,
): void {
  bridge = nextBridge;
}

export function getCurrentServices(): Context.Context<any> | undefined {
  return bridge?.getCurrentServices();
}
