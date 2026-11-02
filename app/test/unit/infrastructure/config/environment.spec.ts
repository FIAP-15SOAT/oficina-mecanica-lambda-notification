import { loadEnvironment } from '@infrastructure/config/environment';
import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

const MINIMUM: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  SMTP_HOST: 'mailhog.internal',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Oficina <noreply@oficina.local>',
};

describe('loadEnvironment', () => {
  it('should parse the smtp destination and the sender', () => {
    expect(loadEnvironment(MINIMUM)).toMatchObject({
      SMTP_HOST: 'mailhog.internal',
      SMTP_PORT: 1025,
      MAIL_FROM: 'Oficina <noreply@oficina.local>',
    });
  });

  it('should accept a known log level', () => {
    expect(loadEnvironment({ ...MINIMUM, LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug');
  });

  it('should read the process environment by default', () => {
    const replaced = jest.replaceProperty(process, 'env', MINIMUM);

    expect(loadEnvironment().SMTP_HOST).toBe('mailhog.internal');

    replaced.restore();
  });

  it('should label a problem with no path as coming from the root', () => {
    expect(() => loadEnvironment(null as unknown as NodeJS.ProcessEnv)).toThrow('(raiz)');
  });

  it.each([
    ['SMTP_HOST', { SMTP_HOST: undefined }],
    ['MAIL_FROM', { MAIL_FROM: '' }],
    ['SMTP_PORT', { SMTP_PORT: '70000' }],
    ['NODE_ENV', { NODE_ENV: 'staging' }],
  ])('should reject the configuration naming %s', (variable, override) => {
    expect(() => loadEnvironment({ ...MINIMUM, ...override })).toThrow(ConfigurationException);
    expect(() => loadEnvironment({ ...MINIMUM, ...override })).toThrow(variable);
  });
});
