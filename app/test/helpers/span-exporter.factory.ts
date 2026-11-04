import { ExportResultCode } from '@opentelemetry/core';
import type { SpanExporter } from '@opentelemetry/sdk-trace';

// Answers on a later turn, like a network export: a synchronous answer would leave the pending list before flush
export function createFailingSpanExporter(error: Error): SpanExporter {
  return {
    export: (_spans, resultCallback) => {
      setImmediate(() => resultCallback({ code: ExportResultCode.FAILED, error }));
    },
    shutdown: () => Promise.resolve(),
  };
}
