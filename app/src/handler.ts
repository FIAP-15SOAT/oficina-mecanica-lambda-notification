import { Context, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';
import {
  ExecutionAttributes,
  resolveExecutionAttributes,
} from '@infrastructure/logging/execution-attributes';
import { resolveTraceId, TRACE_ID_ATTRIBUTE } from '@infrastructure/logging/trace-context';
import {
  parseNotificationMessage,
  ParsedNotificationMessage,
} from '@infrastructure/serverless/notification-message.parser';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { getBaseLogger, getDependencies } from './bootstrap';

export const UNSPECIFIED_PURPOSE = 'unspecified';

// Same as the queue's maxReceiveCount: a failure on this delivery moves the message to the DLQ
export const MAX_RECEIVE_COUNT = 5;

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  // Outside any catch: a broken configuration fails the invocation and the whole batch returns to the queue
  const { sendEmailController } = getDependencies();
  const execution = resolveExecutionAttributes(context);
  const failedGroups = new Set<string | undefined>();
  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    const group = record.attributes.MessageGroupId;

    // A later message of a failed group is returned untried, so the group keeps its order
    if (failedGroups.has(group) || !(await processRecord(record, execution, sendEmailController))) {
      failedGroups.add(group);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}

async function processRecord(
  record: SQSRecord,
  execution: ExecutionAttributes,
  sendEmailController: SendEmailController,
): Promise<boolean> {
  const parsed = parseNotificationMessage(record.body);

  const logger = getBaseLogger().withAttributes(
    resolveMessageAttributes(record, parsed, execution),
  );

  const purpose = parsed.purpose ?? UNSPECIFIED_PURPOSE;

  const failureOutcome =
    Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVE_COUNT
      ? 'dead_lettered'
      : 'retry';

  if (!parsed.ok) {
    logger.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, {
      messageType: parsed.type,
      purpose,
      outcome: failureOutcome,
      failureReason: 'invalid_message',
    });

    return false;
  }

  const recipientCount = parsed.payload.to.length;

  const result = await sendEmailController.send(parsed.payload);

  if (result.outcome === 'sent') {
    logger.event(BUSINESS_EVENTS.NOTIFICATION_SENT, {
      messageType: parsed.type,
      purpose,
      recipientCount,
      outcome: 'sent',
    });

    return true;
  }

  logger.event(
    BUSINESS_EVENTS.NOTIFICATION_FAILED,
    {
      messageType: parsed.type,
      purpose,
      recipientCount,
      outcome: failureOutcome,
      failureReason: result.failureReason,
    },
    result.error,
  );

  return false;
}

function resolveMessageAttributes(
  record: SQSRecord,
  parsed: ParsedNotificationMessage,
  execution: ExecutionAttributes,
): Record<string, unknown> {
  const traceId = resolveTraceId(record.messageAttributes.traceparent?.stringValue);

  return {
    ...execution,
    'messaging.message.id': parsed.messageId ?? record.messageId,
    'messaging.destination.name': record.eventSourceARN.split(':').at(-1),
    ...(traceId === undefined ? {} : { [TRACE_ID_ATTRIBUTE]: traceId }),
    ...(parsed.workOrderId ? { 'oficina.work_order.id': parsed.workOrderId } : {}),
  };
}
