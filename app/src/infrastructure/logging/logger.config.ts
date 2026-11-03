export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_SERVICE_NAME = 'oficina-mecanica-lambda-notification';
export const DEFAULT_SERVICE_NAMESPACE = 'oficina-mecanica';
export const DEFAULT_SERVICE_VERSION = 'dev';
export const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development';

export interface ResourceAttributes {
  'service.name': string;
  'service.namespace': string;
  'service.version': string;
  'deployment.environment.name': string;
}

export interface LoggerConfig {
  level: LogLevel;
  resource: ResourceAttributes;
}

export function resolveLoggerConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
  return {
    level: resolveLevel(env.LOG_LEVEL),
    resource: {
      'service.name': withDefault(env.OTEL_SERVICE_NAME, DEFAULT_SERVICE_NAME),
      'service.namespace': withDefault(env.OTEL_SERVICE_NAMESPACE, DEFAULT_SERVICE_NAMESPACE),
      'service.version': withDefault(env.SERVICE_VERSION, DEFAULT_SERVICE_VERSION),
      'deployment.environment.name': withDefault(env.NODE_ENV, DEFAULT_DEPLOYMENT_ENVIRONMENT),
    },
  };
}

function withDefault(value: string | undefined, defaultValue: string): string {
  const trimmed = value?.trim();

  return trimmed || defaultValue;
}

function resolveLevel(value: string | undefined): LogLevel {
  const candidate = value?.trim().toLowerCase();

  return (LOG_LEVELS as readonly string[]).includes(candidate ?? '')
    ? (candidate as LogLevel)
    : DEFAULT_LOG_LEVEL;
}
