import {
  DEFAULT_DEPLOYMENT_ENVIRONMENT,
  DEFAULT_LOG_LEVEL,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SERVICE_NAMESPACE,
  DEFAULT_SERVICE_VERSION,
  resolveLoggerConfig,
} from '@infrastructure/logging/logger.config';

describe('resolveLoggerConfig', () => {
  it('should fall back to the documented defaults', () => {
    const config = resolveLoggerConfig({});

    expect(config.level).toBe(DEFAULT_LOG_LEVEL);

    expect(config.resource).toEqual({
      'service.name': DEFAULT_SERVICE_NAME,
      'service.namespace': DEFAULT_SERVICE_NAMESPACE,
      'service.version': DEFAULT_SERVICE_VERSION,
      'deployment.environment.name': DEFAULT_DEPLOYMENT_ENVIRONMENT,
    });
  });

  it('should read every resource attribute from the environment', () => {
    const config = resolveLoggerConfig({
      LOG_LEVEL: ' WARN ',
      OTEL_SERVICE_NAME: 'notification',
      OTEL_SERVICE_NAMESPACE: 'oficina',
      SERVICE_VERSION: '1.2.3',
      NODE_ENV: 'production',
    });

    expect(config.level).toBe('warn');

    expect(config.resource).toEqual({
      'service.name': 'notification',
      'service.namespace': 'oficina',
      'service.version': '1.2.3',
      'deployment.environment.name': 'production',
    });
  });

  it('should ignore blank values and keep the defaults', () => {
    expect(resolveLoggerConfig({ OTEL_SERVICE_NAME: '   ', LOG_LEVEL: '  ' }).resource).toEqual(
      resolveLoggerConfig({}).resource,
    );
  });

  it('should warn and fall back when the level is unknown', () => {
    const config = resolveLoggerConfig({ LOG_LEVEL: 'verboso' });

    expect(config.level).toBe(DEFAULT_LOG_LEVEL);
  });

  /**
   * Deliberate divergence: machine and process identification are not emitted —
   * in an ephemeral environment they describe nothing stable, and the `faas.*`
   * attributes fill that role.
   */
  it('should not carry machine or process identity', () => {
    const resource: Record<string, unknown> = { ...resolveLoggerConfig({}).resource };

    expect(resource['host.name']).toBeUndefined();
    expect(resource['process.pid']).toBeUndefined();
    expect(resource['service.instance.id']).toBeUndefined();
  });
});
