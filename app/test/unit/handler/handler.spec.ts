import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { Transporter } from 'nodemailer';

import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { SendEmailUseCase } from '@application/use-cases/notification/send-email.use-case';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { EmailDeliveryException } from '@infrastructure/exceptions/email-delivery.exception';
import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';
import { SmtpEmailSender } from '@infrastructure/smtp/smtp-email-sender';
import { buildTracing, NO_OP_TRACING } from '@infrastructure/telemetry/tracing';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { getBaseLogger, getDependencies } from '../../../src/bootstrap';
import { handler } from '../../../src/handler';
import { captureDiagnostics, DiagnosticsCapture } from '../../helpers/diagnostics-capture';
import { captureLog, LogCapture } from '../../helpers/log-capture';
import {
  createMockEmailSender,
  RECIPIENT,
  SENDER,
  VALID_PAYLOAD,
} from '../../helpers/notification-mock.factory';
import { createFailingSpanExporter } from '../../helpers/span-exporter.factory';
import {
  buildContext,
  buildEnvelope,
  buildEvent,
  buildRecord,
  PARENT_SPAN_ID,
  QUEUE_NAME,
  TRACE_ID,
  TRACEPARENT,
  WORK_ORDER_ID,
} from '../../helpers/sqs-event.factory';

jest.mock('../../../src/bootstrap', () => ({
  getDependencies: jest.fn(),
  getBaseLogger: jest.fn(),
}));

const dependenciesMock = getDependencies as jest.MockedFunction<typeof getDependencies>;
const baseLoggerMock = getBaseLogger as jest.MockedFunction<typeof getBaseLogger>;
const { purpose: _purpose, ...PAYLOAD_WITHOUT_PURPOSE } = VALID_PAYLOAD;

describe('handler', () => {
  let capture: LogCapture;
  let stderr: DiagnosticsCapture;
  let emailSender: jest.Mocked<IEmailSender>;
  let spanExporter: InMemorySpanExporter;

  beforeEach(() => {
    capture = captureLog();

    stderr = captureDiagnostics();

    emailSender = createMockEmailSender();

    spanExporter = new InMemorySpanExporter();

    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(new SendEmailUseCase(emailSender)),
      tracing: buildTracing(spanExporter),
    });

    baseLoggerMock.mockReturnValue(capture.adapter);
  });

  afterEach(() => {
    stderr.restore();
  });

  it('should send every message in order and log notification.sent for each one', async () => {
    const envelopes = ['first', 'second', 'third'].map((subject) =>
      buildEnvelope({
        payload: { ...VALID_PAYLOAD, subject, to: [RECIPIENT, 'joao@example.com'] },
      }),
    );

    const response = await handler(
      buildEvent(...envelopes.map((envelope) => buildRecord({ body: JSON.stringify(envelope) }))),
      buildContext(),
    );

    expect(response).toEqual({ batchItemFailures: [] });

    expect(emailSender.send.mock.calls.map(([message]) => message.subject)).toEqual([
      'first',
      'second',
      'third',
    ]);

    expect(capture.lines()).toEqual(
      envelopes.map((envelope) =>
        expect.objectContaining({
          'oficina.event.name': 'notification.sent',
          'messaging.message.id': envelope.messageId,
          'messaging.destination.name': QUEUE_NAME,
          'oficina.messaging.message.type': 'notification.email.send',
          'oficina.notification.purpose': 'staff_initial_password',
          'oficina.notification.recipient.count': 2,
          'oficina.notification.outcome': 'sent',
        }),
      ),
    );
  });

  it('should return the failed message and the later ones of its group without trying or logging them', async () => {
    const records = [buildRecord(), buildRecord(), buildRecord()];
    emailSender.send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new EmailDeliveryException());

    const response = await handler(buildEvent(...records), buildContext());

    expect(response).toEqual({
      batchItemFailures: [
        { itemIdentifier: records[1].messageId },
        { itemIdentifier: records[2].messageId },
      ],
    });

    expect(emailSender.send).toHaveBeenCalledTimes(2);

    expect(capture.lines()).toEqual([
      expect.objectContaining({ 'oficina.event.name': 'notification.sent' }),
      expect.objectContaining({
        'oficina.event.name': 'notification.failed',
        'oficina.notification.failure.reason': 'smtp_error',
        'oficina.notification.outcome': 'retry',
        'oficina.notification.recipient.count': 1,
        'exception.type': 'EmailDeliveryException',
      }),
    ]);
  });

  it('should keep sending the messages of other groups after a failure', async () => {
    const records = [
      buildRecord(),
      buildRecord(),
      buildRecord({ attributes: { MessageGroupId: 'group-2' } }),
    ];
    emailSender.send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new EmailDeliveryException());

    const response = await handler(buildEvent(...records), buildContext());

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: records[1].messageId }] });
    expect(emailSender.send).toHaveBeenCalledTimes(3);

    expect(capture.lines().map((line) => line['oficina.event.name'])).toEqual([
      'notification.sent',
      'notification.failed',
      'notification.sent',
    ]);
  });

  it('should return the fifth failed delivery and log it as dead_lettered', async () => {
    const record = buildRecord({ attributes: { ApproximateReceiveCount: '5' } });
    emailSender.send.mockRejectedValue(new EmailDeliveryException());

    const response = await handler(buildEvent(record), buildContext());

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: record.messageId }] });
    expect(capture.lines()[0]['oficina.notification.outcome']).toBe('dead_lettered');
  });

  it.each([
    [
      'an empty recipient list',
      { payload: { ...VALID_PAYLOAD, to: [], purpose: 'quote_sent' } },
      { 'oficina.notification.purpose': 'quote_sent' },
    ],
    [
      'an unexpected type',
      { type: 'billing.quote.sent' },
      { 'oficina.messaging.message.type': 'billing.quote.sent' },
    ],
  ])(
    'should return a message with %s as invalid_message without sending it',
    async (_case, envelopeOverrides, expectedFields) => {
      const envelope = buildEnvelope(envelopeOverrides);
      const record = buildRecord({ body: JSON.stringify(envelope) });

      const response = await handler(buildEvent(record), buildContext());

      expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: record.messageId }] });
      expect(emailSender.send).not.toHaveBeenCalled();

      expect(capture.lines()).toEqual([
        expect.objectContaining({
          'oficina.event.name': 'notification.failed',
          'oficina.notification.failure.reason': 'invalid_message',
          'oficina.notification.outcome': 'retry',
          'messaging.message.id': envelope.messageId,
          ...expectedFields,
        }),
      ]);
    },
  );

  it('should return an unreadable message as invalid_message logged with the queue message id', async () => {
    const record = buildRecord({ body: '{' });

    const response = await handler(buildEvent(record), buildContext());

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: record.messageId }] });
    expect(emailSender.send).not.toHaveBeenCalled();

    expect(capture.lines()).toEqual([
      expect.objectContaining({
        'oficina.event.name': 'notification.failed',
        'oficina.notification.failure.reason': 'invalid_message',
        'messaging.message.id': record.messageId,
        'oficina.notification.purpose': 'unspecified',
      }),
    ]);
  });

  it.each([
    ['outside the format', { ...VALID_PAYLOAD, purpose: 'Senha inicial: Tmp#4821' }],
    ['absent', PAYLOAD_WITHOUT_PURPOSE],
  ])('should send the email and log unspecified when the purpose is %s', async (_case, payload) => {
    const record = buildRecord({ body: JSON.stringify(buildEnvelope({ payload })) });

    const response = await handler(buildEvent(record), buildContext());

    expect(response).toEqual({ batchItemFailures: [] });
    expect(emailSender.send).toHaveBeenCalledTimes(1);
    expect(capture.lines()[0]['oficina.notification.purpose']).toBe('unspecified');
  });

  it('should fail the invocation when the composition fails', async () => {
    const failure = new ConfigurationException('Configuração inválida: SMTP_HOST — obrigatório');
    dependenciesMock.mockImplementation(() => {
      throw failure;
    });

    await expect(handler(buildEvent(buildRecord()), buildContext())).rejects.toBe(failure);
  });

  it('should carry the received trace_id on every line of the message', async () => {
    await handler(buildEvent(buildRecord(), buildRecord({ body: '{' })), buildContext());

    expect(capture.lines().map((line) => line.trace_id)).toEqual([TRACE_ID, TRACE_ID]);
  });

  it.each([
    ['absent', undefined, undefined],
    ['with a zero trace id', `00-${'0'.repeat(32)}-${PARENT_SPAN_ID}-01`, undefined],
    ['with a zero parent id', `00-${TRACE_ID}-${'0'.repeat(16)}-01`, undefined],
    ['uppercase', TRACEPARENT.toUpperCase(), undefined],
    ['of version ff', `ff-${TRACE_ID}-${PARENT_SPAN_ID}-01`, undefined],
    ['unsampled', `00-${TRACE_ID}-${PARENT_SPAN_ID}-00`, TRACE_ID],
  ])(
    'should send the email and export no span when the traceparent is %s',
    async (_case, traceparent, expectedTraceId) => {
      const record = buildRecord({
        messageAttributes: {
          type: { dataType: 'String', stringValue: 'notification.email.send' },
          ...(traceparent === undefined
            ? {}
            : { traceparent: { dataType: 'String', stringValue: traceparent } }),
        },
      });

      const response = await handler(buildEvent(record), buildContext());

      expect(response).toEqual({ batchItemFailures: [] });
      expect(emailSender.send).toHaveBeenCalledTimes(1);
      expect(spanExporter.getFinishedSpans()).toEqual([]);
      expect(capture.lines()[0].trace_id).toBe(expectedTraceId);
    },
  );

  it('should export one consumer span per message with the values of its log event', async () => {
    await handler(buildEvent(buildRecord(), buildRecord()), buildContext());

    const spans = spanExporter.getFinishedSpans().map((span) => ({
      name: span.name,
      kind: span.kind,
      traceId: span.spanContext().traceId,
      parentSpanId: span.parentSpanContext?.spanId,
      attributes: span.attributes,
      status: span.status,
      events: span.events,
    }));

    expect(spans).toEqual(
      capture.lines().map((line) => ({
        name: 'process notification.fifo',
        kind: SpanKind.CONSUMER,
        traceId: TRACE_ID,
        parentSpanId: PARENT_SPAN_ID,
        attributes: {
          'messaging.system': 'aws_sqs',
          'messaging.operation.name': 'process',
          'messaging.operation.type': 'process',
          'messaging.destination.name': line['messaging.destination.name'],
          'messaging.message.id': line['messaging.message.id'],
          'oficina.work_order.id': line['oficina.work_order.id'],
          'oficina.notification.purpose': line['oficina.notification.purpose'],
          'oficina.notification.outcome': line['oficina.notification.outcome'],
        },
        status: { code: SpanStatusCode.UNSET },
        events: [],
      })),
    );

    expect(spans).toHaveLength(2);
  });

  it('should keep the tracestate of the producer on the parent of the span', async () => {
    const record = buildRecord({
      messageAttributes: {
        type: { dataType: 'String', stringValue: 'notification.email.send' },
        traceparent: { dataType: 'String', stringValue: TRACEPARENT },
        tracestate: { dataType: 'String', stringValue: 'dd=s:1' },
      },
    });

    await handler(buildEvent(record), buildContext());

    expect(spanExporter.getFinishedSpans()[0].parentSpanContext?.traceState?.get('dd')).toBe('s:1');
  });

  it('should end the span of an smtp rejection on the second delivery as retry with error.type smtp_error', async () => {
    const record = buildRecord({ attributes: { ApproximateReceiveCount: '2' } });
    emailSender.send.mockRejectedValue(new EmailDeliveryException());

    await handler(buildEvent(record), buildContext());

    const [span] = spanExporter.getFinishedSpans();

    expect(span.status).toEqual({ code: SpanStatusCode.ERROR });

    expect(span.attributes).toMatchObject({
      'oficina.notification.outcome': 'retry',
      'error.type': 'smtp_error',
    });

    expect(span.events).toEqual([]);
  });

  it('should end the span of an empty recipient list on the fifth delivery as dead_lettered with error.type invalid_message', async () => {
    const record = buildRecord({
      body: JSON.stringify(buildEnvelope({ payload: { ...VALID_PAYLOAD, to: [] } })),
      attributes: { ApproximateReceiveCount: '5' },
    });

    await handler(buildEvent(record), buildContext());

    const [span] = spanExporter.getFinishedSpans();

    expect(span.status).toEqual({ code: SpanStatusCode.ERROR });

    expect(span.attributes).toMatchObject({
      'oficina.notification.outcome': 'dead_lettered',
      'error.type': 'invalid_message',
    });
  });

  it('should give each delivery of the same message its own span under the same parent', async () => {
    const record = buildRecord();

    emailSender.send.mockRejectedValueOnce(new EmailDeliveryException());

    await handler(buildEvent(record), buildContext());
    await handler(buildEvent(record), buildContext());

    const [first, second] = spanExporter.getFinishedSpans();

    expect([first, second].map((span) => span.attributes['oficina.notification.outcome'])).toEqual([
      'retry',
      'sent',
    ]);

    expect(second.spanContext().traceId).toBe(first.spanContext().traceId);
    expect(second.parentSpanContext?.spanId).toBe(first.parentSpanContext?.spanId);
    expect(second.spanContext().spanId).not.toBe(first.spanContext().spanId);
  });

  it('should leave the work order id out of the span when the envelope has none', async () => {
    const record = buildRecord({ body: JSON.stringify(buildEnvelope({ workOrderId: null })) });

    await handler(buildEvent(record), buildContext());

    expect(spanExporter.getFinishedSpans()[0].attributes).not.toHaveProperty(
      'oficina.work_order.id',
    );
  });

  it('should give an unreadable message a span with the queue message id and error.type invalid_message', async () => {
    const record = buildRecord({ body: '{' });

    await handler(buildEvent(record), buildContext());

    expect(spanExporter.getFinishedSpans()[0].attributes).toMatchObject({
      'messaging.message.id': record.messageId,
      'oficina.notification.purpose': 'unspecified',
      'error.type': 'invalid_message',
    });
  });

  it('should return the same batchItemFailures and report export when the span export fails', async () => {
    const records = [buildRecord(), buildRecord({ attributes: { MessageGroupId: 'group-2' } })];

    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(new SendEmailUseCase(emailSender)),
      tracing: buildTracing(createFailingSpanExporter(new Error('Request timed out'))),
    });
    emailSender.send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new EmailDeliveryException());

    const response = await handler(buildEvent(...records), buildContext());

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: records[1].messageId }] });

    expect(stderr.lines()).toEqual([
      expect.objectContaining({
        message: 'telemetry failure',
        'oficina.telemetry.failure.stage': 'export',
      }),
    ]);
  });

  it('should send, log the trace_id and export nothing when span export is off', async () => {
    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(new SendEmailUseCase(emailSender)),
      tracing: NO_OP_TRACING,
    });

    const response = await handler(buildEvent(buildRecord()), buildContext());

    expect(response).toEqual({ batchItemFailures: [] });
    expect(capture.lines()[0].trace_id).toBe(TRACE_ID);
    expect(stderr.lines()).toEqual([]);
  });

  it('should carry the work order id of the envelope on every line of the message', async () => {
    await handler(buildEvent(buildRecord(), buildRecord()), buildContext());

    expect(capture.lines().map((line) => line['oficina.work_order.id'])).toEqual([
      WORK_ORDER_ID,
      WORK_ORDER_ID,
    ]);
  });

  it('should omit the work order id when the envelope has none', async () => {
    const record = buildRecord({ body: JSON.stringify(buildEnvelope({ workOrderId: null })) });

    await handler(buildEvent(record), buildContext());

    expect(capture.lines()[0]).not.toHaveProperty('oficina.work_order.id');
  });

  it('should keep every emitted key inside the dictionary', async () => {
    emailSender.send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new EmailDeliveryException());

    await handler(
      buildEvent(buildRecord(), buildRecord({ attributes: { MessageGroupId: 'group-2' } })),
      buildContext(),
    );

    const keys = capture.lines().flatMap((line) => Object.keys(line));

    expect(keys.filter((key) => !DECLARED_FIELD_NAMES.has(key))).toEqual([]);
  });

  it('should never write the subject, text, html or recipient of a sent email', async () => {
    await handler(buildEvent(buildRecord()), buildContext());

    const raw = capture.raw();

    for (const value of [
      VALID_PAYLOAD.subject,
      VALID_PAYLOAD.text,
      VALID_PAYLOAD.html,
      RECIPIENT,
    ]) {
      expect(raw).not.toContain(value);
    }
  });

  it('should never write the recipient repeated by an smtp rejection', async () => {
    const transporter: Pick<Transporter, 'sendMail'> = {
      sendMail: jest
        .fn()
        .mockRejectedValue(new Error('550 5.1.1 <maria@example.com>: Recipient address rejected')),
    };

    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(
        new SendEmailUseCase(new SmtpEmailSender(transporter, SENDER)),
      ),
      tracing: buildTracing(spanExporter),
    });

    await handler(buildEvent(buildRecord()), buildContext());

    expect(capture.lines()[0]['oficina.notification.failure.reason']).toBe('smtp_error');
    expect(capture.raw()).not.toContain('@example.com');
  });

  it('should keep the email content and the smtp error text out of the span', async () => {
    const transporter: Pick<Transporter, 'sendMail'> = {
      sendMail: jest
        .fn()
        .mockRejectedValue(new Error('550 5.1.1 <maria@example.com>: Recipient address rejected')),
    };

    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(
        new SendEmailUseCase(new SmtpEmailSender(transporter, SENDER)),
      ),
      tracing: buildTracing(spanExporter),
    });

    await handler(buildEvent(buildRecord()), buildContext());

    const [span] = spanExporter.getFinishedSpans();
    const exported = JSON.stringify([span.attributes, span.events, span.status]);

    expect(span.attributes['error.type']).toBe('smtp_error');

    for (const value of [
      '@example.com',
      'Recipient address rejected',
      VALID_PAYLOAD.subject,
      VALID_PAYLOAD.text,
      VALID_PAYLOAD.html,
    ]) {
      expect(exported).not.toContain(value);
    }
  });
});
