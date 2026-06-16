import type { Context } from "effect";

export interface ServiceContextBridge {
  readonly getCurrentServices: () => Context.Context<any> | undefined;
  readonly runWithServices?: <T>(
    services: Context.Context<any>,
    fn: () => Promise<T>,
  ) => Promise<T>;
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

export function runWithServices<T>(
  services: Context.Context<any>,
  fn: () => Promise<T>,
): Promise<T> {
  return bridge?.runWithServices?.(services, fn) ?? fn();
}
