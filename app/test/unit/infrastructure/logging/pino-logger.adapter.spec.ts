import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { captureLog, TEST_RESOURCE } from '../../../helpers/log-capture';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('PinoLoggerAdapter — envelope', () => {
  it('should write one independent, parseable JSON object per line', () => {
    const capture = captureLog();

    capture.adapter.event(TECHNICAL_EVENTS.CONFIGURATION_INVALID, {});
    capture.adapter.event(TECHNICAL_EVENTS.INITIALIZATION_FAILED, {});

    const rendered = capture
      .raw()
      .split('\n')
      .filter((line) => line.length > 0);

    expect(rendered).toHaveLength(2);
    rendered.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  it('should carry timestamp in ISO-8601 UTC, a textual level and a stable message', () => {
    const capture = captureLog();

    capture.adapter.event(TECHNICAL_EVENTS.CONFIGURATION_INVALID, {});

    const [line] = capture.lines();

    expect(line.timestamp).toEqual(expect.stringMatching(ISO_UTC));
    expect(line.level).toBe('error');
    expect(line.message).toBe('execution environment could not be initialized');
  });

  it('should carry the resource attributes and nothing about machine or process', () => {
    const capture = captureLog();

    capture.adapter.event(TECHNICAL_EVENTS.CONFIGURATION_INVALID, {});

    const [line] = capture.lines();

    expect(line).toMatchObject(TEST_RESOURCE);
    expect(line.pid).toBeUndefined();
    expect(line.hostname).toBeUndefined();
  });

  it('should bind the given attributes to every line it emits', () => {
    const capture = captureLog();
    const logger = capture.adapter.withAttributes({
      'faas.coldstart': true,
      'messaging.message.id': 'msg-1',
    });

    logger.event(TECHNICAL_EVENTS.CONFIGURATION_INVALID, {});
    logger.event(TECHNICAL_EVENTS.INITIALIZATION_FAILED, {});

    capture
      .lines()
      .forEach((line) =>
        expect(line).toMatchObject({ 'faas.coldstart': true, 'messaging.message.id': 'msg-1' }),
      );
  });
});

describe('PinoLoggerAdapter — catalog and dictionary', () => {
  it('should emit the event name, level and message from the catalog', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_SENT, {
      messageType: 'notification.email.send',
      purpose: 'quote_sent',
      recipientCount: 1,
      outcome: 'sent',
    });

    expect(capture.lines()[0]).toMatchObject({
      level: 'info',
      message: 'email accepted by the smtp server',
      'oficina.event.name': 'notification.sent',
      'oficina.messaging.message.type': 'notification.email.send',
      'oficina.notification.purpose': 'quote_sent',
      'oficina.notification.recipient.count': 1,
      'oficina.notification.outcome': 'sent',
    });
  });

  it('should sanitize a textual field', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, {
      messageType: 'maria.silva@gmail.com',
      purpose: 'unspecified',
      outcome: 'retry',
      failureReason: 'invalid_message',
    });

    expect(capture.raw()).not.toContain('maria.silva@gmail.com');
  });

  it('should pass a non-textual value through untouched', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, {
      purpose: 'unspecified',
      outcome: 'retry',
      failureReason: 42,
    } as never);

    expect(capture.lines()[0]['oficina.notification.failure.reason']).toBe(42);
  });

  it('should skip absent optional fields instead of emitting null', () => {
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, {
      messageType: undefined,
      purpose: 'unspecified',
      recipientCount: undefined,
      outcome: 'retry',
      failureReason: 'invalid_message',
    });

    expect(capture.lines()[0]['oficina.messaging.message.type']).toBeUndefined();
    expect(capture.lines()[0]['oficina.notification.recipient.count']).toBeUndefined();
  });

  it('should report a logical field the registry does not know and drop it', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const capture = captureLog();

    capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, {
      failureReason: 'invalid_message',
      quoteId: 'x',
    } as never);

    expect(String(stderr.mock.calls[0][0])).toContain('"oficina.logging.failure.field":"quoteId"');
    expect(capture.raw()).not.toContain('quoteId');

    stderr.mockRestore();
  });

  it('should attach the described error to an event', () => {
    const capture = captureLog();

    capture.adapter.event(TECHNICAL_EVENTS.INITIALIZATION_FAILED, {}, new Error('timeout'));

    expect(capture.lines()[0]).toMatchObject({
      level: 'error',
      'oficina.event.name': 'app.initialization.failed',
      'exception.message': 'timeout',
    });
  });

  it('should not let a failing record build interrupt the caller', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const capture = captureLog();

    const hostile = {
      get failureReason(): string {
        throw new RangeError('hostil');
      },
    };

    expect(() =>
      capture.adapter.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, hostile as never),
    ).not.toThrow();
    expect(String(stderr.mock.calls[0][0])).toContain('"oficina.logging.failure.stage":"emit"');

    stderr.mockRestore();
  });
});
