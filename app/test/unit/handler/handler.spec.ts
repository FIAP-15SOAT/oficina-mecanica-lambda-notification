import { Transporter } from 'nodemailer';

import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { SendEmailUseCase } from '@application/use-cases/notification/send-email.use-case';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { EmailDeliveryException } from '@infrastructure/exceptions/email-delivery.exception';
import { DECLARED_FIELD_NAMES } from '@infrastructure/logging/field-registry';
import { SmtpEmailSender } from '@infrastructure/smtp/smtp-email-sender';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { getBaseLogger, getDependencies } from '../../../src/bootstrap';
import { handler } from '../../../src/handler';
import { captureLog, LogCapture } from '../../helpers/log-capture';
import {
  createMockEmailSender,
  RECIPIENT,
  SENDER,
  VALID_PAYLOAD,
} from '../../helpers/notification-mock.factory';
import {
  buildContext,
  buildEnvelope,
  buildEvent,
  buildRecord,
  QUEUE_NAME,
  TRACE_ID,
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
  let emailSender: jest.Mocked<IEmailSender>;

  beforeEach(() => {
    capture = captureLog();

    emailSender = createMockEmailSender();

    dependenciesMock.mockReturnValue({
      sendEmailController: new SendEmailController(new SendEmailUseCase(emailSender)),
    });

    baseLoggerMock.mockReturnValue(capture.adapter);
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

  it('should omit trace_id when the message has no traceparent', async () => {
    const record = buildRecord({
      messageAttributes: { type: { dataType: 'String', stringValue: 'notification.email.send' } },
    });

    await handler(buildEvent(record), buildContext());

    expect(capture.lines()[0]).not.toHaveProperty('trace_id');
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
    });

    await handler(buildEvent(buildRecord()), buildContext());

    expect(capture.lines()[0]['oficina.notification.failure.reason']).toBe('smtp_error');
    expect(capture.raw()).not.toContain('@example.com');
  });
});
