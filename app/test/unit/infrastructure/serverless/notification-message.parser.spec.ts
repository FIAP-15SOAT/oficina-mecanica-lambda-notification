import { parseNotificationMessage } from '@infrastructure/serverless/notification-message.parser';

import { RECIPIENT, VALID_PAYLOAD } from '../../../helpers/notification-mock.factory';
import { buildEnvelope, WORK_ORDER_ID } from '../../../helpers/sqs-event.factory';

const MESSAGE_ID = '0c8b2f4e-5d6a-4b7c-8e9f-0a1b2c3d4e5f';
const { purpose: _purpose, ...PAYLOAD_WITHOUT_PURPOSE } = VALID_PAYLOAD;

function bodyWith(overrides: Record<string, unknown>): string {
  return JSON.stringify(buildEnvelope(overrides));
}

function bodyWithPayload(payload: Record<string, unknown>): string {
  return bodyWith({ messageId: MESSAGE_ID, payload });
}

function bodyWithout(key: string): string {
  const { [key]: _removed, ...envelope } = buildEnvelope();

  return JSON.stringify(envelope);
}

describe('parseNotificationMessage', () => {
  it('should accept a valid notification.email.send message', () => {
    const result = parseNotificationMessage(bodyWith({ messageId: MESSAGE_ID }));

    expect(result).toEqual({
      ok: true,
      messageId: MESSAGE_ID,
      type: 'notification.email.send',
      workOrderId: WORK_ORDER_ID,
      purpose: 'staff_initial_password',
      payload: PAYLOAD_WITHOUT_PURPOSE,
    });
  });

  it.each([
    ['null', null],
    ['absent', undefined],
  ])('should accept a message whose workOrderId is %s', (_case, workOrderId) => {
    const result = parseNotificationMessage(bodyWith({ workOrderId }));

    expect(result).toEqual(expect.objectContaining({ ok: true, workOrderId: null }));
  });

  it('should accept an occurredAt with offset', () => {
    const result = parseNotificationMessage(bodyWith({ occurredAt: '2026-11-01T12:00:00-03:00' }));

    expect(result.ok).toBe(true);
  });

  it('should ignore payload fields outside the catalog', () => {
    const result = parseNotificationMessage(
      bodyWithPayload({ ...PAYLOAD_WITHOUT_PURPOSE, cc: ['joao@example.com'] }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: true, payload: PAYLOAD_WITHOUT_PURPOSE }));
  });

  it.each([
    ['not json', '{'],
    ['a json array', '[]'],
    ['without messageId', bodyWithout('messageId')],
    ['with a non v4 messageId', bodyWith({ messageId: '1c905c27-4c5e-1d85-a53d-914ed8b87bbe' })],
    ['with an invalid occurredAt', bodyWith({ occurredAt: 'yesterday' })],
    ['with an invalid workOrderId', bodyWith({ workOrderId: 'abc' })],
    ['with a text payload', bodyWith({ payload: 'x' })],
  ])('should reject an envelope %s without identifiers', (_case, body) => {
    expect(parseNotificationMessage(body)).toEqual({ ok: false });
  });

  it('should reject another message type keeping the envelope identifiers', () => {
    const result = parseNotificationMessage(
      bodyWith({ messageId: MESSAGE_ID, type: 'billing.quote.sent' }),
    );

    expect(result).toEqual({
      ok: false,
      messageId: MESSAGE_ID,
      type: 'billing.quote.sent',
      workOrderId: WORK_ORDER_ID,
    });
  });

  it.each([
    ['to as text', { to: RECIPIENT }],
    ['a numeric recipient', { to: [42] }],
    ['a numeric subject', { subject: 1 }],
    ['html as a file reference', { html: { path: '/etc/passwd' } }],
    ['text as a url reference', { text: { href: 'http://169.254.169.254/' } }],
    ['no text', { text: undefined }],
  ])('should reject a payload with %s keeping the envelope identifiers', (_case, override) => {
    const result = parseNotificationMessage(
      bodyWithPayload({ ...PAYLOAD_WITHOUT_PURPOSE, ...override }),
    );

    expect(result).toEqual({
      ok: false,
      messageId: MESSAGE_ID,
      type: 'notification.email.send',
      workOrderId: WORK_ORDER_ID,
    });
  });

  it('should read a purpose in the expected format', () => {
    const result = parseNotificationMessage(
      bodyWithPayload({ ...PAYLOAD_WITHOUT_PURPOSE, purpose: 'quote_sent' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        purpose: 'quote_sent',
        payload: PAYLOAD_WITHOUT_PURPOSE,
      }),
    );
  });

  it.each([
    ['absent', undefined],
    ['not text', 42],
    ['uppercase', 'QUOTE_SENT'],
    ['with digits', 'code_482193'],
    ['an address', 'maria@example.com'],
    ['free text', 'Senha inicial: Tmp#4821'],
    ['longer than 40 characters', 'a'.repeat(41)],
  ])('should leave the purpose out when it is %s', (_case, purpose) => {
    const result = parseNotificationMessage(
      bodyWithPayload({ ...PAYLOAD_WITHOUT_PURPOSE, purpose }),
    );

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('purpose');
  });

  it('should keep the purpose of a payload that fails the schema', () => {
    const result = parseNotificationMessage(
      bodyWithPayload({ ...PAYLOAD_WITHOUT_PURPOSE, to: RECIPIENT, purpose: 'quote_sent' }),
    );

    expect(result).toEqual({
      ok: false,
      messageId: MESSAGE_ID,
      type: 'notification.email.send',
      workOrderId: WORK_ORDER_ID,
      purpose: 'quote_sent',
    });
  });
});
