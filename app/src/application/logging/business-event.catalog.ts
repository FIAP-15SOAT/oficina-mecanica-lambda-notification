import { defineLogEvent } from './log-event';

export type NotificationFailureReason = 'invalid_message' | 'smtp_error';

export const BUSINESS_EVENTS = {
  NOTIFICATION_SENT: defineLogEvent<{
    messageType: string;
    purpose: string;
    recipientCount: number;
    outcome: 'sent';
  }>({
    name: 'notification.sent',
    message: 'email accepted by the smtp server',
    level: 'info',
  }),
  NOTIFICATION_FAILED: defineLogEvent<{
    messageType?: string;
    purpose: string;
    recipientCount?: number;
    outcome: 'retry' | 'dead_lettered';
    failureReason: NotificationFailureReason;
  }>({
    name: 'notification.failed',
    message: 'email not delivered; the message returns to the queue',
    level: 'error',
  }),
} as const;
