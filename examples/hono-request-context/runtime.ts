import { NodeSdk } from "@effect/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Layer, Logger, ManagedRuntime } from "effect";

import { OrderService } from "./services/order";

const NodeSdkLive = NodeSdk.layer(() => ({
  resource: { serviceName: "effect-orpc-hono-request-context" },
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: "http://localhost:4318/v1/traces",
    }),
  ),
}));

const LoggerLive = Logger.layer([Logger.consolePretty()]);

export const AppLive = Layer.mergeAll(
  LoggerLive,
  NodeSdkLive,
  OrderService.layer,
);

export const runtime = ManagedRuntime.make(AppLive);
