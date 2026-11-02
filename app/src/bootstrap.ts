import { SendEmailUseCase } from '@application/use-cases/notification/send-email.use-case';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { createDefaultDestination } from '@infrastructure/logging/logging-destination';
import { createLogger } from '@infrastructure/logging/logger.factory';
import { resolveLoggerConfig } from '@infrastructure/logging/logger.config';
import { PinoLoggerAdapter } from '@infrastructure/logging/pino-logger.adapter';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { SmtpEmailSender } from '@infrastructure/smtp/smtp-email-sender';

export interface Dependencies {
  sendEmailController: SendEmailController;
}

let cached: Dependencies | undefined;
let baseLogger: PinoLoggerAdapter | undefined;

// Lives outside the memoized composition: a failed composition still needs a logger to report it
export function getBaseLogger(): PinoLoggerAdapter {
  if (!baseLogger) {
    const { level, resource } = resolveLoggerConfig();

    baseLogger = new PinoLoggerAdapter(createLogger(createDefaultDestination(), level, resource));
  }

  return baseLogger;
}

// A failed composition is not memoized, so the next invocation tries again
export function getDependencies(): Dependencies {
  cached ??= build();

  return cached;
}

// Test-only: the platform reuses the composition for the life of the execution environment
export function resetDependencies(): void {
  cached = undefined;
  baseLogger = undefined;
}

function build(): Dependencies {
  try {
    return compose();
  } catch (error) {
    getBaseLogger().event(
      error instanceof ConfigurationException
        ? TECHNICAL_EVENTS.CONFIGURATION_INVALID
        : TECHNICAL_EVENTS.INITIALIZATION_FAILED,
      {},
      error,
    );

    throw error;
  }
}

function compose(): Dependencies {
  const environment = loadEnvironment();

  return {
    sendEmailController: new SendEmailController(
      new SendEmailUseCase(SmtpEmailSender.create(environment)),
    ),
  };
}
