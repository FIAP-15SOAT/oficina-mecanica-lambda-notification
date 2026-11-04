import { trace, Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOffSampler,
  ParentBasedSampler,
  SimpleSpanProcessor,
  SpanExporter,
  TracerProvider,
} from '@opentelemetry/sdk-trace';

import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { reportTelemetryFailure } from '@infrastructure/telemetry/telemetry-diagnostics';

const TRACER_NAME = 'oficina.messaging';
const EXPORT_TIMEOUT_MS = 500;

export interface Tracing {
  tracer: Tracer;
  flush(): Promise<void>;
}

export const NO_OP_TRACING: Tracing = {
  tracer: trace.getTracer(TRACER_NAME),
  flush: () => Promise.resolve(),
};

export function createTracing(): Tracing {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
    return NO_OP_TRACING;
  }

  try {
    return buildTracing(new OTLPTraceExporter({ timeoutMillis: EXPORT_TIMEOUT_MS }));
  } catch (error) {
    reportTelemetryFailure('startup', error);

    return NO_OP_TRACING;
  }
}

export function buildTracing(exporter: SpanExporter): Tracing {
  // Flushed through the processor, not the provider: the provider rejects with a list of errors
  const processor = new SimpleSpanProcessor({ exporter });

  const provider = new TracerProvider({
    resource: resourceFromAttributes({ ...resolveLoggerConfig().resource }),
    sampler: new ParentBasedSampler({ root: new AlwaysOffSampler() }),
    spanProcessors: [processor],
  });

  return {
    tracer: provider.getTracer(TRACER_NAME),
    // shortcut: forceFlush awaits only pending exports and one that already failed goes to the silent SDK error handler; with one message per invocation the span ends right before the flush; revisit if the batch grows
    flush: () =>
      processor.forceFlush().catch((error: unknown) => reportTelemetryFailure('export', error)),
  };
}
