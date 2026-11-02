import { resolveLoggerConfig } from './logger.config';

/**
 * An `'error'` event with no listener on a Node stream kills the process, and
 * `stderr` accepts the write and emits the error later, asynchronously — out of
 * reach of the writer's `try/catch` below.
 */
process.stderr.on('error', () => undefined);

export type LoggingFailureStage = 'serialization' | 'emit' | 'destination';

export const DESTINATION_FAILURE_POLICY = 'continue-degraded';

export interface LoggingFailureDetail {
  field?: string;
  errorType?: string;
}

let destinationFailureReported = false;

/**
 * The logger's own diagnostic channel, which is why it writes straight to
 * `stderr` (fd 2) instead of using `ILogger`: reporting the failure through the
 * path that just broke risks recursion, and when what failed is the destination
 * — `stdout` — logging there guarantees silence.
 *
 * The detail carries only the field name and the error type. Never the value:
 * this line must not become the leak path that redaction exists to prevent.
 */
export function reportLoggingFailure(
  stage: LoggingFailureStage,
  detail: LoggingFailureDetail = {},
): void {
  writeDiagnostic({
    'oficina.logging.failure.stage': stage,
    ...(detail.field ? { 'oficina.logging.failure.field': detail.field } : {}),
    ...(detail.errorType ? { 'oficina.logging.failure.error_type': detail.errorType } : {}),
  });
}

export function reportDestinationFailure(): void {
  if (destinationFailureReported) {
    return;
  }

  destinationFailureReported = true;

  writeDiagnostic({
    'oficina.logging.failure.stage': 'destination',
    'oficina.logging.failure.policy': DESTINATION_FAILURE_POLICY,
  });
}

function writeDiagnostic(attributes: Record<string, string>): void {
  try {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'logging failure',
        ...resolveLoggerConfig().resource,
        ...attributes,
      })}\n`,
    );
  } catch {
    return;
  }
}

export function runSafelyVoid(stage: LoggingFailureStage, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    reportLoggingFailure(stage, { errorType: resolveErrorTypeName(error) });
  }
}

function resolveErrorTypeName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
