import { Logger } from 'pino';

import { LogEventDefinition, LogLevelName } from '@application/logging/log-event';
import { LogFields } from '@application/logging/log-field';
import { ILogger, NoExtraFields } from '@application/ports/output/logger.service.interface';

import { describeError } from './error-serializer';
import { EVENT_NAME_FIELD, resolveLogicalField } from './field-registry';
import { reportLoggingFailure, runSafelyVoid } from './logging-diagnostics';
import { sanitizeText } from './redaction/text-sanitizer';

export class PinoLoggerAdapter implements ILogger {
  constructor(
    private readonly pinoLogger: Logger,
    private readonly attributes: Record<string, unknown> = {},
  ) {}

  withAttributes(attributes: Record<string, unknown>): PinoLoggerAdapter {
    return new PinoLoggerAdapter(this.pinoLogger, attributes);
  }

  event<TFields extends LogFields, TGiven extends TFields>(
    definition: LogEventDefinition<TFields>,
    fields: NoExtraFields<TFields, TGiven>,
    error?: unknown,
  ): void {
    this.emit(definition.level, definition.message, () => ({
      [EVENT_NAME_FIELD]: definition.name,
      ...(error === undefined ? {} : describeError(error)),
      ...mapFields(fields),
    }));
  }

  private emit(
    level: LogLevelName,
    message: string,
    buildRecord: () => Record<string, unknown>,
  ): void {
    runSafelyVoid('emit', () => {
      this.pinoLogger[level]({ ...this.attributes, ...buildRecord() }, message);
    });
  }
}

function mapFields(fields: LogFields): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [logicalName, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }

    const key = resolveLogicalField(logicalName);

    if (!key) {
      reportLoggingFailure('emit', { field: logicalName });

      continue;
    }

    mapped[key] = sanitizeValue(value);
  }

  return mapped;
}

function sanitizeValue(value: unknown): unknown {
  return typeof value === 'string' ? sanitizeText(value) : value;
}
