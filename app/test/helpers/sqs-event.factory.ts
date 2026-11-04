import { randomUUID } from 'node:crypto';
import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api';
import type { Context, SQSEvent, SQSRecord, SQSRecordAttributes } from 'aws-lambda';

import { VALID_PAYLOAD } from './notification-mock.factory';

export const QUEUE_NAME = 'notification.fifo';
export const WORK_ORDER_ID = '3f0b6a6e-2a8b-4c7e-9b7a-1d2e3f4a5b6c';
export const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
export const PARENT_SPAN_ID = '00f067aa0ba902b7';
export const TRACEPARENT = `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`;
export const SAMPLED_PARENT_CONTEXT = trace.setSpanContext(ROOT_CONTEXT, {
  traceId: TRACE_ID,
  spanId: PARENT_SPAN_ID,
  traceFlags: TraceFlags.SAMPLED,
  isRemote: true,
});

export function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: randomUUID(),
    type: 'notification.email.send',
    occurredAt: '2026-11-01T12:00:00.000Z',
    workOrderId: WORK_ORDER_ID,
    payload: VALID_PAYLOAD,
    ...overrides,
  };
}

export type RecordOverrides = Partial<Omit<SQSRecord, 'attributes'>> & {
  attributes?: Partial<SQSRecordAttributes>;
};

export function buildRecord({ attributes, ...overrides }: RecordOverrides = {}): SQSRecord {
  return {
    messageId: randomUUID(),
    receiptHandle: 'receipt-handle',
    body: JSON.stringify(buildEnvelope()),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1793534400000',
      SenderId: 'AIDAEXAMPLE',
      ApproximateFirstReceiveTimestamp: '1793534400000',
      MessageGroupId: 'group-1',
      ...attributes,
    },
    messageAttributes: {
      type: { dataType: 'String', stringValue: 'notification.email.send' },
      traceparent: { dataType: 'String', stringValue: TRACEPARENT },
    },
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: `arn:aws:sqs:us-east-1:000000000000:${QUEUE_NAME}`,
    awsRegion: 'us-east-1',
    ...overrides,
  };
}

export function buildEvent(...records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

export function buildContext(overrides: Partial<Context> = {}): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'lbd-oficina-mecanica-notification',
    functionVersion: '3',
    invokedFunctionArn:
      'arn:aws:lambda:us-east-1:000000000000:function:lbd-oficina-mecanica-notification',
    memoryLimitInMB: '256',
    awsRequestId: '8f0c4b0e-1b7c-4a1a-9a0a-9b1e8c6d2f31',
    logGroupName: '/aws/lambda/lbd-oficina-mecanica-notification',
    logStreamName: '2026/11/01/[3]abcdef0123456789',
    getRemainingTimeInMillis: () => 5_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
    ...overrides,
  };
}
