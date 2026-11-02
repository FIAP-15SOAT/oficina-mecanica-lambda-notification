import { Writable } from 'node:stream';
import type { DestinationStream } from 'pino';

import { createLogger } from '@infrastructure/logging/logger.factory';
import { LogLevel, ResourceAttributes } from '@infrastructure/logging/logger.config';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';

export const TEST_RESOURCE: ResourceAttributes = {
  'service.name': 'oficina-mecanica-lambda-notification',
  'service.namespace': 'oficina-mecanica',
  'service.version': 'test',
  'deployment.environment.name': 'test',
};

export interface LogCapture {
  adapter: PinoLoggerAdapter;
  raw(): string;
  lines(): Record<string, unknown>[];
}

export function captureLog(level: LogLevel = 'debug'): LogCapture {
  const chunks: string[] = [];

  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  }) as unknown as DestinationStream;

  return {
    adapter: new PinoLoggerAdapter(createLogger(destination, level, TEST_RESOURCE)),
    raw: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
