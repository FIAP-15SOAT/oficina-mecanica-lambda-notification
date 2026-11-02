import { z } from 'zod';

import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';
import { LOG_LEVELS } from '@infrastructure/logging/logger.config';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().max(65535),
  MAIL_FROM: z.string().min(1),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigurationException(
      `Configuração inválida: ${result.error.issues
        .map((issue) => `${issue.path.join('.') || '(raiz)'} — ${issue.message}`)
        .join('; ')}`,
    );
  }

  return result.data;
}
