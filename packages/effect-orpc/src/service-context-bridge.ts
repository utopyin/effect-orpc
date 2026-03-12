import type { ServiceMap } from "effect";

export interface ServiceContextBridge {
  readonly getCurrentServices: () => ServiceMap.ServiceMap<any> | undefined;
}

let bridge: ServiceContextBridge | undefined;

export function installServiceContextBridge(
  nextBridge: ServiceContextBridge | undefined,
): void {
  bridge = nextBridge;
}

export function getCurrentServices(): ServiceMap.ServiceMap<any> | undefined {
  return bridge?.getCurrentServices();
}
