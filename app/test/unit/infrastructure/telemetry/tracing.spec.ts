import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';

import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { buildTracing, createTracing, NO_OP_TRACING } from '@infrastructure/telemetry/tracing';

import { captureDiagnostics, DiagnosticsCapture } from '../../../helpers/diagnostics-capture';
import { createFailingSpanExporter } from '../../../helpers/span-exporter.factory';
import { SAMPLED_PARENT_CONTEXT } from '../../../helpers/sqs-event.factory';

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: jest.fn() }));

const otlpTraceExporterMock = OTLPTraceExporter as jest.MockedClass<typeof OTLPTraceExporter>;

describe('tracing', () => {
  let stderr: DiagnosticsCapture;

  beforeEach(() => {
    stderr = captureDiagnostics();
  });

  afterEach(() => {
    stderr.restore();
  });

  describe('createTracing', () => {
    const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    beforeEach(() => {
      otlpTraceExporterMock.mockReset();
    });

    afterEach(() => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    });

    it('should export spans with the log resource through an exporter limited to 500 ms when the endpoint is set', async () => {
      const exporter = new InMemorySpanExporter();

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      otlpTraceExporterMock.mockImplementation(() => exporter as unknown as OTLPTraceExporter);

      const tracing = createTracing();
      tracing.tracer.startSpan('process', {}, SAMPLED_PARENT_CONTEXT).end();
      await tracing.flush();

      expect(OTLPTraceExporter).toHaveBeenCalledWith({ timeoutMillis: 500 });

      expect(exporter.getFinishedSpans()[0].resource.attributes).toEqual(
        resolveLoggerConfig().resource,
      );
    });

    it.each([
      ['absent', undefined],
      ['blank', '  '],
    ])(
      'should return the no-op tracing without an exporter when the endpoint is %s',
      (_case, endpoint) => {
        if (endpoint === undefined) {
          delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
        } else {
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT = endpoint;
        }

        const tracing = createTracing();

        expect(tracing).toBe(NO_OP_TRACING);
        expect(OTLPTraceExporter).not.toHaveBeenCalled();
        expect(stderr.lines()).toEqual([]);
      },
    );

    it('should return the no-op tracing and report startup when the exporter cannot be built', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
      otlpTraceExporterMock.mockImplementation(() => {
        throw new TypeError('Invalid URL');
      });

      const tracing = createTracing();

      expect(tracing).toBe(NO_OP_TRACING);

      expect(stderr.lines()).toEqual([
        expect.objectContaining({
          message: 'telemetry failure',
          'oficina.telemetry.failure.stage': 'startup',
          'oficina.telemetry.failure.error_type': 'TypeError',
        }),
      ]);
    });
  });

  describe('flush', () => {
    let stdoutWriteSpy: jest.SpyInstance;

    beforeEach(() => {
      stdoutWriteSpy = jest.spyOn(process.stdout, 'write');
    });

    afterEach(() => {
      stdoutWriteSpy.mockRestore();
    });

    it.each([
      [
        'refuses the connection',
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4318'), { code: 'ECONNREFUSED' }),
      ],
      ['exceeds the limit', new Error('Request timed out')],
    ])(
      'should resolve, report export and write nothing to stdout when the receiver %s',
      async (_case, error) => {
        const tracing = buildTracing(createFailingSpanExporter(error));

        tracing.tracer.startSpan('process', {}, SAMPLED_PARENT_CONTEXT).end();

        await expect(tracing.flush()).resolves.toBeUndefined();

        expect(stderr.lines()).toEqual([
          expect.objectContaining({
            message: 'telemetry failure',
            'oficina.telemetry.failure.stage': 'export',
            'oficina.telemetry.failure.error_type': 'Error',
          }),
        ]);

        expect(stderr.text()).not.toContain(error.message);
        expect(stdoutWriteSpy).not.toHaveBeenCalled();
      },
    );
  });
});
