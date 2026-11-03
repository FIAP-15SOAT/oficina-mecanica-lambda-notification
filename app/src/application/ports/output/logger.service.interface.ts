import { LogEventDefinition } from '@application/logging/log-event';
import { LogFields } from '@application/logging/log-field';

export type NoExtraFields<TAllowed, TGiven> = TGiven &
  Record<Exclude<keyof TGiven, keyof TAllowed>, never>;

export interface ILogger {
  event<TFields extends LogFields, TGiven extends TFields>(
    definition: LogEventDefinition<TFields>,
    fields: NoExtraFields<TFields, TGiven>,
    error?: unknown,
  ): void;
}
