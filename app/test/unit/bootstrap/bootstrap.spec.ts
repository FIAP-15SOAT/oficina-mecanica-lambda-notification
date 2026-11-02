import { ConfigurationException } from '@infrastructure/exceptions/configuration.exception';

import { getDependencies, resetDependencies } from '../../../src/bootstrap';

const mockLines: string[] = [];

jest.mock('@infrastructure/logging/logging-destination', () => {
  const { Writable } = jest.requireActual<typeof import('node:stream')>('node:stream');

  return {
    createDefaultDestination: () =>
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          mockLines.push(chunk.toString('utf8'));
          callback();
        },
      }),
  };
});

const ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Oficina Mecânica <noreply@oficina.local>',
};

describe('bootstrap', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...ENVIRONMENT };

    mockLines.length = 0;

    resetDependencies();
  });

  afterEach(() => {
    process.env = original;
  });

  it('should compose once and reuse the dependencies', () => {
    expect(getDependencies()).toBe(getDependencies());
  });

  it('should log app.configuration.invalid and rethrow when the environment is invalid', () => {
    delete process.env.SMTP_HOST;

    expect(() => getDependencies()).toThrow(ConfigurationException);

    expect(mockLines).toHaveLength(1);
    expect(JSON.parse(mockLines[0])).toEqual(
      expect.objectContaining({ 'oficina.event.name': 'app.configuration.invalid' }),
    );
  });

  it('should compose again after a failed composition', () => {
    delete process.env.SMTP_HOST;

    expect(() => getDependencies()).toThrow(ConfigurationException);

    process.env.SMTP_HOST = ENVIRONMENT.SMTP_HOST;

    expect(getDependencies().sendEmailController).toBeDefined();
  });
});
