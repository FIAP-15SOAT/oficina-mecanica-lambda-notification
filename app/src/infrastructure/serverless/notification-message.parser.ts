import { z } from 'zod';

import { NotificationMessagePayloads } from '@domain/messaging/notification.messages';

export const EMAIL_SEND_TYPE = 'notification.email.send';

type EmailSendPayload = NotificationMessagePayloads[typeof EMAIL_SEND_TYPE];

export type ParsedNotificationMessage =
  | {
      ok: true;
      messageId: string;
      type: string;
      workOrderId: string | null;
      purpose?: string;
      payload: EmailSendPayload;
    }
  | {
      ok: false;
      messageId?: string;
      type?: string;
      workOrderId?: string | null;
      purpose?: string;
    };

const envelopeSchema = z.object({
  messageId: z.uuid({ version: 'v4' }),
  type: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  workOrderId: z.uuid().nullish(),
  payload: z.record(z.string(), z.unknown()),
});

// Unknown fields are dropped, so a producer can add one before this function reads it
const payloadSchema = z.object({
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
}) satisfies z.ZodType<EmailSendPayload>;

// No digit, @, space or uppercase: the value cannot carry an id, address, code or password into the log
const purposeSchema = z
  .string()
  .max(40)
  .regex(/^[a-z]+(_[a-z]+)*$/) satisfies z.ZodType<NonNullable<EmailSendPayload['purpose']>>;

export function parseNotificationMessage(body: string): ParsedNotificationMessage {
  const envelope = envelopeSchema.safeParse(parseJson(body));

  if (!envelope.success) {
    return { ok: false };
  }

  const { messageId, type, workOrderId = null, payload } = envelope.data;
  const identifiers = { messageId, type, workOrderId };

  if (type !== EMAIL_SEND_TYPE) {
    return { ok: false, ...identifiers };
  }

  const purpose = purposeSchema.safeParse(payload.purpose);
  const readPurpose = purpose.success ? { purpose: purpose.data } : {};
  const email = payloadSchema.safeParse(payload);

  return email.success
    ? { ok: true, ...identifiers, ...readPurpose, payload: email.data }
    : { ok: false, ...identifiers, ...readPurpose };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
