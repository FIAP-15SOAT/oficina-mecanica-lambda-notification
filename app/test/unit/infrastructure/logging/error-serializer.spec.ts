import { describeError, resolveErrorMessage } from '@infrastructure/logging/error-serializer';
import { REDACTED } from '@infrastructure/logging/redaction/text-sanitizer';

class DatabaseOperationFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

describe('describeError exception.type', () => {
  /**
   * When a library wraps the real error in a generic `Error`, the useful name is
   * further down the chain — reporting `"Error"` would hide which layer broke.
   */
  it('should prefer the specific name found deeper in the cause chain', () => {
    const wrapped = new Error('falha ao aprovar', {
      cause: new DatabaseOperationFailure('conexão perdida'),
    });

    expect(describeError(wrapped)['exception.type']).toBe('DatabaseOperationFailure');
  });

  it('should fall back to the generic name when the whole chain is generic', () => {
    expect(describeError(new Error('genérico'))['exception.type']).toBe('Error');
  });

  it('should classify a thrown string', () => {
    expect(describeError('falhou')['exception.type']).toBe('Error');
  });

  it('should classify a thrown value that is neither error nor string', () => {
    expect(describeError({ code: 42 })['exception.type']).toBe('UnknownError');
  });

  it('should report an unknown type when there is nothing to inspect', () => {
    expect(describeError(undefined)['exception.type']).toBe('UnknownError');
  });

  it('should use the constructor name when the error carries an empty name', () => {
    const anonymous = new Error('sem nome');
    anonymous.name = '';

    expect(describeError(anonymous)['exception.type']).toBe('Error');
  });
});

describe('resolveErrorMessage', () => {
  it('should sanitize the message of an error', () => {
    expect(resolveErrorMessage(new Error('cliente 123.456.789-09'))).toBe('cliente ***.***.789-09');
  });

  it('should sanitize a thrown string', () => {
    expect(resolveErrorMessage('Bearer abcdef1234567890')).toBe(REDACTED);
  });

  it('should describe a thrown value that carries no message', () => {
    expect(resolveErrorMessage({ code: 42 })).toBe('Unknown error');
  });
});

describe('describeError', () => {
  it('should map an error onto the three semantic convention attributes', () => {
    const attributes = describeError(new DatabaseOperationFailure('conexão perdida'));

    expect(attributes['exception.type']).toBe('DatabaseOperationFailure');
    expect(attributes['exception.message']).toBe('conexão perdida');
    expect(attributes['exception.stacktrace']).toContain('DatabaseOperationFailure');
  });

  it('should fold a chained cause into the stacktrace without a cause namespace', () => {
    const attributes = describeError(
      new Error('falha ao aprovar', { cause: new TypeError('camada de baixo') }),
    );

    expect(attributes['exception.stacktrace']).toContain('Caused by:');
    expect(Object.keys(attributes).some((key) => key.startsWith('exception.cause'))).toBe(false);
  });

  it('should omit the stacktrace when no frame is available', () => {
    const attributes = describeError('apenas texto');

    expect(attributes['exception.type']).toBe('Error');
    expect(attributes).not.toHaveProperty(['exception.stacktrace']);
  });

  it('should sanitize sensitive content found inside the stacktrace', () => {
    const error = new Error('falha');
    error.stack = 'Error: falha\n    at handler (postgresql://u:senha@db/oficina)';

    expect(describeError(error)['exception.stacktrace']).not.toContain('senha');
  });

  /**
   * `cause` can form a cycle and the chain can be arbitrarily long; with no
   * bound and no detection, serializing the error hangs the process.
   */
  it('should stop at a cycle in the cause chain', () => {
    const first = new Error('primeiro');
    const second = new Error('segundo', { cause: first });
    (first as Error & { cause?: unknown }).cause = second;

    expect(() => describeError(first)).not.toThrow();
    expect(describeError(first)['exception.message']).toBe('primeiro');
  });

  it('should bound the depth of the cause chain', () => {
    let error = new Error('nível 0');

    for (let level = 1; level <= 10; level += 1) {
      error = new Error(`nível ${level}`, { cause: error });
    }

    const stacktrace = describeError(error)['exception.stacktrace'] ?? '';

    /**
     * The bound is asserted from both sides, without depending on the stack
     * length: the top of the chain is in, the fifth link is never in, and the
     * number of links does not exceed the cap. Asserting an exact count would
     * couple the test to the 8192-character truncation, which varies with the
     * project's absolute path — it passes on Windows and fails on the Linux
     * runner.
     */
    expect(stacktrace).toContain('nível 10');
    expect(stacktrace).not.toContain('nível 6');
    expect(stacktrace.split('Caused by:').length).toBeLessThanOrEqual(4);
  });

  it('should stop the chain at a cause that is not an error', () => {
    const attributes = describeError(new Error('falha', { cause: 'motivo textual' }));

    expect(attributes['exception.type']).toBe('Error');
  });
});
