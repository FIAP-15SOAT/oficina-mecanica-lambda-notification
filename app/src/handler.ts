import {
  defaultTextMapGetter,
  ROOT_CONTEXT,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
  Tracer,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { Context, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import {
  BUSINESS_EVENTS,
  NotificationFailureReason,
} from '@application/logging/business-event.catalog';
import {
  ExecutionAttributes,
  resolveExecutionAttributes,
} from '@infrastructure/logging/execution-attributes';
import { parseNotificationMessage } from '@infrastructure/serverless/notification-message.parser';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { getBaseLogger, getDependencies } from './bootstrap';

export const UNSPECIFIED_PURPOSE = 'unspecified';

// Same as the queue's maxReceiveCount: a failure on this delivery moves the message to the DLQ
export const MAX_RECEIVE_COUNT = 5;

const traceContextPropagator = new W3CTraceContextPropagator();

interface SpanOutcomeFields {
  purpose: string;
  outcome: 'sent' | 'retry' | 'dead_lettered';
  failureReason?: NotificationFailureReason;
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  // Outside any catch: a broken configuration fails the invocation and the whole batch returns to the queue
  const { sendEmailController, tracing } = getDependencies();
  const execution = resolveExecutionAttributes(context);
  const failedGroups = new Set<string | undefined>();
  const batchItemFailures: SQSBatchItemFailure[] = [];

  try {
    for (const record of event.Records) {
      const group = record.attributes.MessageGroupId;

      // A later message of a failed group is returned untried, so the group keeps its order
      if (
        failedGroups.has(group) ||
        !(await processRecord(record, execution, sendEmailController, tracing.tracer))
      ) {
        failedGroups.add(group);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  } finally {
    // Before the response: the platform may freeze the environment right after it
    await tracing.flush();
  }

  return { batchItemFailures };
}

async function processRecord(
  record: SQSRecord,
  execution: ExecutionAttributes,
  sendEmailController: SendEmailController,
  tracer: Tracer,
): Promise<boolean> {
  const destinationName = record.eventSourceARN.slice(record.eventSourceARN.lastIndexOf(':') + 1);

  const { span, traceId } = startRecordSpan(tracer, record, destinationName);

  try {
    return await processMessage(
      record,
      {
        ...execution,
        'messaging.destination.name': destinationName,
        ...(traceId === undefined ? {} : { trace_id: traceId }),
      },
      span,
      sendEmailController,
    );
  } finally {
    span.end();
  }
}

async function processMessage(
  record: SQSRecord,
  logAttributes: Record<string, unknown>,
  span: Span,
  sendEmailController: SendEmailController,
): Promise<boolean> {
  const parsed = parseNotificationMessage(record.body);

  const identity = {
    'messaging.message.id': parsed.messageId ?? record.messageId,
    ...(parsed.workOrderId ? { 'oficina.work_order.id': parsed.workOrderId } : {}),
  };

  span.setAttributes(identity);

  const logger = getBaseLogger().withAttributes({ ...logAttributes, ...identity });

  const purpose = parsed.purpose ?? UNSPECIFIED_PURPOSE;

  const failureOutcome: 'retry' | 'dead_lettered' =
    Number(record.attributes.ApproximateReceiveCount) >= MAX_RECEIVE_COUNT
      ? 'dead_lettered'
      : 'retry';

  if (!parsed.ok) {
    const fields = {
      messageType: parsed.type,
      purpose,
      outcome: failureOutcome,
      failureReason: 'invalid_message' as const,
    };

    logger.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, fields);
    recordSpanOutcome(span, fields);

    return false;
  }

  const recipientCount = parsed.payload.to.length;

  const result = await sendEmailController.send(parsed.payload);

  if (result.outcome === 'sent') {
    const fields = { messageType: parsed.type, purpose, recipientCount, outcome: 'sent' as const };

    logger.event(BUSINESS_EVENTS.NOTIFICATION_SENT, fields);
    recordSpanOutcome(span, fields);

    return true;
  }

  const fields = {
    messageType: parsed.type,
    purpose,
    recipientCount,
    outcome: failureOutcome,
    failureReason: result.failureReason,
  };

  logger.event(BUSINESS_EVENTS.NOTIFICATION_FAILED, fields, result.error);
  recordSpanOutcome(span, fields);

  return false;
}

// An unsampled parent still names the trace, so the log keeps its trace_id without a span
function startRecordSpan(
  tracer: Tracer,
  record: SQSRecord,
  destinationName: string,
): { span: Span; traceId?: string } {
  const parent = traceContextPropagator.extract(
    ROOT_CONTEXT,
    {
      traceparent: record.messageAttributes.traceparent?.stringValue,
      tracestate: record.messageAttributes.tracestate?.stringValue,
    },
    defaultTextMapGetter,
  );

  const span = tracer.startSpan(
    `process ${destinationName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'aws_sqs',
        'messaging.operation.name': 'process',
        'messaging.operation.type': 'process',
        'messaging.destination.name': destinationName,
      },
    },
    parent,
  );

  return { span, traceId: trace.getSpanContext(parent)?.traceId };
}

// Named fields only: the log fields also carry the message type and the recipient count
function recordSpanOutcome(span: Span, fields: SpanOutcomeFields): void {
  span.setAttributes({
    'oficina.notification.purpose': fields.purpose,
    'oficina.notification.outcome': fields.outcome,
  });

  if (fields.failureReason) {
    span.setAttribute('error.type', fields.failureReason);
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}
