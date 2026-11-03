export type LogicalFieldName =
  'messageType' | 'purpose' | 'recipientCount' | 'outcome' | 'failureReason';

export type LogFields = Partial<Record<LogicalFieldName, unknown>>;
