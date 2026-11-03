import pino, { DestinationStream, Logger } from 'pino';

import { normalizeLogRecord } from './log-record-normalizer';
import { LogLevel, ResourceAttributes } from './logger.config';

export function createLogger(
  destination: DestinationStream,
  level: LogLevel,
  resource: ResourceAttributes,
): Logger {
  return pino(
    {
      level,
      base: { ...resource },
      messageKey: 'message',
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label: string) => ({ level: label }),
        bindings: (bindings: Record<string, unknown>) => bindings,
        log: normalizeLogRecord,
      },
    },
    destination,
  );
}
