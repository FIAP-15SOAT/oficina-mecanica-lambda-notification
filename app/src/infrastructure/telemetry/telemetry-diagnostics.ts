import { resolveErrorTypeName, writeDiagnostic } from '@infrastructure/logging/logging-diagnostics';

export const TELEMETRY_FAILURE_MESSAGE = 'telemetry failure';

export type TelemetryFailureStage = 'startup' | 'export';

// Only the error type: an export error can repeat the receiver address or the payload
export function reportTelemetryFailure(stage: TelemetryFailureStage, error: unknown): void {
  writeDiagnostic(
    TELEMETRY_FAILURE_MESSAGE,
    {
      'oficina.telemetry.failure.stage': stage,
      'oficina.telemetry.failure.error_type': resolveErrorTypeName(error),
    },
    'warn',
  );
}
