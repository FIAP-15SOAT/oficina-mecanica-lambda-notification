import { defineLogEvent } from '@application/logging/log-event';

type EmptyFields = Record<never, never>;

export const TECHNICAL_EVENTS = {
  CONFIGURATION_INVALID: defineLogEvent<EmptyFields>({
    name: 'app.configuration.invalid',
    message: 'execution environment could not be initialized',
    level: 'error',
  }),
  INITIALIZATION_FAILED: defineLogEvent<EmptyFields>({
    name: 'app.initialization.failed',
    message: 'execution environment dependencies could not be initialized',
    level: 'error',
  }),
} as const;
