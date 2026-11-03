import { LogicalFieldName } from '@application/logging/log-field';

export const EVENT_NAME_FIELD = 'oficina.event.name';

export const LOGICAL_FIELDS: Readonly<Record<LogicalFieldName, string>> = {
  messageType: 'oficina.messaging.message.type',
  purpose: 'oficina.notification.purpose',
  recipientCount: 'oficina.notification.recipient.count',
  outcome: 'oficina.notification.outcome',
  failureReason: 'oficina.notification.failure.reason',
};

export const DECLARED_FIELD_NAMES: ReadonlySet<string> = new Set([
  // Envelope
  'timestamp',
  'level',
  'message',
  // Service and environment
  'service.name',
  'service.namespace',
  'service.version',
  'deployment.environment.name',
  // Serverless execution and cloud
  'faas.invocation_id',
  'faas.coldstart',
  'faas.name',
  'faas.version',
  'faas.instance',
  'faas.max_memory',
  'cloud.provider',
  'cloud.platform',
  'cloud.region',
  'cloud.resource_id',
  // Correlation and message
  'trace_id',
  'messaging.message.id',
  'messaging.destination.name',
  'oficina.work_order.id',
  // Error
  'exception.type',
  'exception.message',
  'exception.stacktrace',
  // Event and business fields
  EVENT_NAME_FIELD,
  ...Object.values(LOGICAL_FIELDS),
]);

export function resolveLogicalField(logicalName: string): string | undefined {
  return LOGICAL_FIELDS[logicalName as LogicalFieldName];
}

export function isDeclaredField(name: string): boolean {
  return DECLARED_FIELD_NAMES.has(name);
}
