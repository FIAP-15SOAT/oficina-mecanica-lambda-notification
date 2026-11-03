import { LogFields } from './log-field';

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

declare const EVENT_FIELDS: unique symbol;

export interface LogEventDefinition<TFields extends LogFields = LogFields> {
  readonly name: string;
  readonly message: string;
  readonly level: LogLevelName;
  readonly [EVENT_FIELDS]?: TFields;
}

export function defineLogEvent<TFields extends LogFields>(
  definition: LogEventDefinition<TFields>,
): LogEventDefinition<TFields> {
  return definition;
}
