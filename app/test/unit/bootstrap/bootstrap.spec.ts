import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';

import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { SmtpEmailSender } from '@infrastructure/smtp/smtp-email-sender';
import { NO_OP_TRACING } from '@infrastructure/telemetry/tracing';

import { getDependencies, resetDependencies } from '../../../src/bootstrap';
import { PARENT_SPAN_ID, TRACE_ID } from '../../helpers/sqs-event.factory';

const mockLines: string[] = [];

jest.mock('@infrastructure/logging/logging-destination', () => {
  const { Writable } = jest.requireActual<typeof import('node:stream')>('node:stream');

  return {
    createDefaultDestination: () =>
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          mockLines.push(chunk.toString('utf8'));
          callback();
        },
      }),
  };
});

const ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Oficina Mecânica <noreply@oficina.local>',
};

describe('bootstrap', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...ENVIRONMENT };

    mockLines.length = 0;

    resetDependencies();
  });

  afterEach(() => {
    process.env = original;
  });

  it('should compose once and reuse the dependencies', () => {
    expect(getDependencies()).toBe(getDependencies());
  });

  it('should log app.configuration.invalid and rethrow when the environment is invalid', () => {
    delete process.env.SMTP_HOST;

    expect(() => getDependencies()).toThrow(ConfigurationException);

    expect(mockLines).toHaveLength(1);

    expect(JSON.parse(mockLines[0])).toEqual(
      expect.objectContaining({ 'oficina.event.name': 'app.configuration.invalid' }),
    );
  });

  it('should log app.initialization.failed and rethrow when a dependency cannot be built', () => {
    const createSpy = jest.spyOn(SmtpEmailSender, 'create').mockImplementation(() => {
      throw new TypeError('transporte indisponível');
    });

    expect(() => getDependencies()).toThrow(TypeError);

    expect(mockLines).toHaveLength(1);

    expect(JSON.parse(mockLines[0])).toEqual(
      expect.objectContaining({ 'oficina.event.name': 'app.initialization.failed' }),
    );

    createSpy.mockRestore();
  });

  it('should compose again after a failed composition', () => {
    delete process.env.SMTP_HOST;

    expect(() => getDependencies()).toThrow(ConfigurationException);

    process.env.SMTP_HOST = ENVIRONMENT.SMTP_HOST;

    expect(getDependencies().sendEmailController).toBeDefined();
  });

  it('should compose a recording tracing when the exporter endpoint is set', () => {
    const sampledParent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE_ID,
      spanId: PARENT_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: true,
    });

    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318';

    const span = getDependencies().tracing.tracer.startSpan('probe', {}, sampledParent);

    expect(span.isRecording()).toBe(true);
  });

  it('should compose the no-op tracing when the exporter endpoint is absent', () => {
    expect(getDependencies().tracing).toBe(NO_OP_TRACING);
  });
});
