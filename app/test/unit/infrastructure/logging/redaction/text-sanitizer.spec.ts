import {
  MAX_TEXT_LENGTH,
  REDACTED,
  sanitizeStackTrace,
  sanitizeText,
  truncateText,
} from '@infrastructure/logging/redaction/text-sanitizer';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

describe('sanitizeText', () => {
  it('should preserve free operational text', () => {
    const text = 'Troca de óleo e revisão dos freios dianteiros';

    expect(sanitizeText(text)).toBe(text);
  });

  it('should mask a CPF typed inside free text and keep the rest', () => {
    expect(sanitizeText('Cliente 123.456.789-09 solicitou revisão')).toBe(
      'Cliente ***.***.789-09 solicitou revisão',
    );
  });

  it('should mask an e-mail typed inside free text', () => {
    expect(sanitizeText('Contato: maria.silva@gmail.com para retorno')).toBe(
      'Contato: ma***va@gmail.com para retorno',
    );
  });

  it('should mask a phone typed inside free text', () => {
    expect(sanitizeText('Ligar para (11) 98765-4321 amanhã')).toBe(
      'Ligar para (**) *****-4321 amanhã',
    );
  });

  it('should remove a signed token embedded in free text', () => {
    const sanitized = sanitizeText(`Callback com token ${JWT} expirado`);

    expect(sanitized).toBe(`Callback com token ${REDACTED} expirado`);
    expect(sanitized).not.toContain('eyJ');
  });

  it('should remove an authorization credential embedded in free text', () => {
    const sanitized = sanitizeText('Header recebido: Bearer abcdef1234567890 invalido');

    expect(sanitized).toContain(REDACTED);
    expect(sanitized).not.toContain('abcdef1234567890');
  });

  it.each(['bEaReR', 'BASIC', 'digest', 'tOkEn', 'APIKEY'])(
    'should redact mixed-case credentials and supported punctuation after %s',
    (scheme) => {
      expect(sanitizeText(`Header recebido: ${scheme} AbCd0123._~+/=- invalido`)).toBe(
        `Header recebido: ${REDACTED} invalido`,
      );
    },
  );

  it('should remove a connection string carrying credentials', () => {
    const sanitized = sanitizeText(
      'Falha em postgresql://admin:s3cr3t@db.internal:5432/oficina ao conectar',
    );

    expect(sanitized).toContain(REDACTED);
    expect(sanitized).not.toContain('s3cr3t');
  });

  it('should remove an inline password parameter', () => {
    const sanitized = sanitizeText('dsn=host;password=Tech@2026;db=oficina');

    expect(sanitized).not.toContain('Tech@2026');
    expect(sanitized).toContain(REDACTED);
  });

  it('should truncate before scanning so the cost stays bounded', () => {
    const oversized = `${'a'.repeat(MAX_TEXT_LENGTH * 4)}123.456.789-09`;
    const sanitized = sanitizeText(oversized);

    expect(sanitized).toHaveLength(MAX_TEXT_LENGTH);
    expect(sanitized).not.toContain('123.456.789-09');
  });

  it('should leave a text already within the bound untouched', () => {
    expect(sanitizeText('curto')).toBe('curto');
  });

  it('should apply the same scan to stack traces with a larger bound', () => {
    const stack = `Error: falha\n    at handler (/app/src/x.ts:1:1)\n    token=${JWT}`;
    const sanitized = sanitizeStackTrace(stack);

    expect(sanitized).toContain('at handler');
    expect(sanitized).not.toContain('eyJ');
  });
});

/**
 * Truncation bounds the **size** scanned; it does not bound the **cost**, which
 * was quadratic in three patterns. Each case below is the worst case of that
 * specific pattern — a "near match" that makes the engine walk the whole run
 * and fail at the next delimiter. A single input for all of them does not work:
 * a run of `A` alone has a single word boundary and does not even exercise
 * `url-credentials`.
 *
 * The `url-credentials` near match must contain `://`: without it the pattern
 * never reaches the backtracking quantifier, and the test could not fail —
 * that is how the quadratic case survived a whole round.
 *
 * The budget is loose on purpose. Before the fixes these cases took 432 ms,
 * 25 ms and 12 ms; after, under 1 ms. Any regression to quadratic time blows the
 * limit by two orders of magnitude, so the assertion is not flaky on slow CI.
 */
describe('sanitizeText — linear cost per pattern', () => {
  const BUDGET_MS = 150;
  const LENGTH = MAX_TEXT_LENGTH * 4;

  const worstCases: [string, string][] = [
    ['jwt: a long run without a dot', 'A'.repeat(LENGTH)],
    ['url-credentials: repeated scheme://host: prefixes', 'a://b:'.repeat(LENGTH / 6)],
    ['email: a long run without an at sign', 'a'.repeat(LENGTH)],
    ['auth-scheme: a scheme followed by a long run', `Bearer ${'a'.repeat(LENGTH)}`],
    ['mixed: camelCase, hyphen, underscore and dot', 'aB.cD-eF_gH.'.repeat(LENGTH / 12)],
  ];

  it.each(worstCases)('should stay linear on %s', (_label, input) => {
    const startedAt = process.hrtime.bigint();

    sanitizeStackTrace(input);

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  });
});

describe('truncateText', () => {
  it('should apply the default bound when no explicit one is given', () => {
    expect(truncateText('a'.repeat(MAX_TEXT_LENGTH * 2))).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('should leave a value already within the default bound untouched', () => {
    expect(truncateText('curto')).toBe('curto');
  });
});
