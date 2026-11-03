import {
  DESTINATION_FAILURE_POLICY,
  reportDestinationFailure,
  reportLoggingFailure,
  runSafelyVoid,
} from '@infrastructure/logging/logging-diagnostics';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';

import {
  captureDiagnostics,
  DiagnosticsCapture,
  failDiagnostics,
} from '../../../helpers/diagnostics-capture';

function captureStderr(): DiagnosticsCapture {
  return captureDiagnostics();
}

function writtenLines(stderr: DiagnosticsCapture): Record<string, unknown>[] {
  return stderr.lines();
}

describe('reportLoggingFailure', () => {
  it('should write a single fixed JSON line to stderr', () => {
    const stderr = captureStderr();

    reportLoggingFailure('serialization');

    expect(stderr.spy).toHaveBeenCalledTimes(1);

    expect(writtenLines(stderr)[0]).toMatchObject({
      timestamp: expect.any(String),
      level: 'error',
      message: 'logging failure',
      'oficina.logging.failure.stage': 'serialization',
    });

    stderr.restore();
  });

  /**
   * The diagnostic line carries the field name and the error type, never the
   * value: it must not become the leak path that redaction exists to prevent.
   */
  it('should carry the field and the error type but never a value', () => {
    const stderr = captureStderr();

    reportLoggingFailure('emit', { field: 'unknownField', errorType: 'TypeError' });

    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.field': 'unknownField',
      'oficina.logging.failure.error_type': 'TypeError',
    });

    stderr.restore();
  });

  it('should stay silent when writing the diagnostic itself fails', () => {
    const stderr = failDiagnostics();

    expect(() => reportLoggingFailure('serialization')).not.toThrow();

    stderr.restore();
  });
});

/**
 * pino turns `EPIPE` into a silent no-op, which is exactly the "running blind
 * and nobody notices" failure mode. The declared policy is to continue degraded
 * with a single line on stderr — one per process, so that a broken stdout does
 * not become a storm on stderr.
 */
describe('reportDestinationFailure', () => {
  // The "already reported" flag is per process. Each spec file has its own
  // module registry and no other test here triggers this function, so this is
  // in fact the process's first destination failure.
  it('should report the declared policy on the first destination failure only', () => {
    const stderr = captureStderr();

    reportDestinationFailure();
    reportDestinationFailure();
    reportDestinationFailure();

    expect(stderr.spy).toHaveBeenCalledTimes(1);

    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.stage': 'destination',
      'oficina.logging.failure.policy': DESTINATION_FAILURE_POLICY,
    });

    stderr.restore();
  });

  it('should declare continue-degraded as the policy', () => {
    expect(DESTINATION_FAILURE_POLICY).toBe('continue-degraded');
  });
});

describe('runSafelyVoid', () => {
  it('should run the operation when nothing throws', () => {
    const operation = jest.fn();

    runSafelyVoid('emit', operation);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should absorb the failure and report it', () => {
    const stderr = captureStderr();

    expect(() =>
      runSafelyVoid('emit', () => {
        throw new Error('quebrou');
      }),
    ).not.toThrow();

    expect(stderr.spy).toHaveBeenCalledTimes(1);

    stderr.restore();
  });

  it('should describe a thrown non-error by its type', () => {
    const stderr = captureStderr();

    runSafelyVoid('emit', () => {
      throw 'texto solto';
    });

    expect(writtenLines(stderr)[0]).toMatchObject({
      'oficina.logging.failure.error_type': 'string',
    });

    stderr.restore();
  });
});

/**
 * Measured: an `EPIPE` on stderr — the collector closing the pipe — arrives
 * **asynchronously**, out of the writer's `try/catch`, and killed the process
 * with an uncaught exception. The exact opposite of the `continue-degraded`
 * policy. The listener mirrors the one the stdout destination already
 * registers, for the same reason: an `'error'` event with no listener on a Node
 * stream kills the process.
 */
describe('diagnostics channel — stderr resilience', () => {
  it('should keep an error listener registered on stderr', () => {
    expect(process.stderr.listenerCount('error')).toBeGreaterThan(0);
  });

  it('should not throw when stderr emits an asynchronous error', () => {
    expect(() => process.stderr.emit('error', new Error('EPIPE'))).not.toThrow();
  });

  /**
   * In a shared destination, a line without `service.*` cannot be attributed —
   * and this one may be the only signal left when stdout failed.
   */
  it('should carry the resource attributes that identify the origin', () => {
    const stderr = captureStderr();

    reportLoggingFailure('emit', { field: 'subjectId' });

    const [line] = writtenLines(stderr);

    for (const name of Object.keys(resolveLoggerConfig().resource)) {
      expect(line[name]).toBeDefined();
    }

    expect(line['service.name']).toBe('oficina-mecanica-lambda-notification');
    expect(line['deployment.environment.name']).toBeDefined();
    expect(line['oficina.logging.failure.field']).toBe('subjectId');

    stderr.restore();
  });
});
