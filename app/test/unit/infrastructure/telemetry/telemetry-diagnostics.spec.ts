import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { reportTelemetryFailure } from '@infrastructure/telemetry/telemetry-diagnostics';

import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';

describe('reportTelemetryFailure', () => {
  let stderr: DiagnosticsCapture;

  beforeEach(() => {
    stderr = captureDiagnostics();
  });

  afterEach(() => {
    stderr.restore();
  });

  it('should write one warn line with the stage and the error type to stderr', () => {
    reportTelemetryFailure('export', new Error('connect ECONNREFUSED 127.0.0.1:4318'));

    expect(stderr.lines()).toEqual([
      {
        timestamp: expect.any(String),
        level: 'warn',
        message: 'telemetry failure',
        ...resolveLoggerConfig().resource,
        'oficina.telemetry.failure.stage': 'export',
        'oficina.telemetry.failure.error_type': 'Error',
      },
    ]);

    expect(stderr.text()).not.toContain('ECONNREFUSED');
  });

  it('should describe a thrown non-error by its type', () => {
    reportTelemetryFailure('startup', 'texto solto');

    expect(stderr.lines()[0]).toMatchObject({
      'oficina.telemetry.failure.stage': 'startup',
      'oficina.telemetry.failure.error_type': 'string',
    });
  });
});
