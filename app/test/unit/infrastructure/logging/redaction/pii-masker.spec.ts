import { MASK, maskScalar } from '@infrastructure/logging/redaction/pii-masker';

describe('maskScalar', () => {
  it('should mask a person name preserving the edges', () => {
    expect(maskScalar('Maria Silva')).toBe('Ma***va');
  });

  it('should mask a CPF preserving its shape', () => {
    expect(maskScalar('123.456.789-09')).toBe('***.***.789-09');
  });

  it('should mask a CNPJ preserving its shape', () => {
    expect(maskScalar('12.345.678/0001-95')).toBe('**.***.***/****-95');
  });

  it('should mask a phone preserving its shape', () => {
    expect(maskScalar('(11) 98765-4321')).toBe('(**) *****-4321');
  });

  it('should mask a zip code preserving its shape', () => {
    expect(maskScalar('01310-100')).toBe('*****-100');
  });

  it('should mask the local part of an e-mail and keep the domain', () => {
    expect(maskScalar('maria.silva@gmail.com')).toBe('ma***va@gmail.com');
  });

  it.each(['b.c', 'sub.example.com', 'b..c', 'b.c.', '...', '.b.c', 'domínio.br', '😀.😀'])(
    'should preserve the existing e-mail shape policy for domain "%s"',
    (domain) => {
      expect(maskScalar(`maria.silva@${domain}`)).toBe(`ma***va@${domain}`);
    },
  );

  it.each([
    ['@example.com', '@e***om'],
    ['maria.silva@example', 'ma***le'],
    ['maria.silva@.bc', 'ma***bc'],
    ['maria.silva@bc.', 'ma***c.'],
    ['maria.silva@..', 'ma***..'],
    ['maria.silva@@example.com', 'ma***om'],
    ['maria.silva@b c.com', 'ma***om'],
    [' maria.silva@example.com', ' m***om'],
    ['maria.silva@example.com\n', 'ma***m\n'],
    ['maria.silva@example.com\u00a0', 'ma***m\u00a0'],
  ])('should use free-text masking for the invalid e-mail shape %p', (value, masked) => {
    expect(maskScalar(value)).toBe(masked);
  });

  it('should mask an invalid dotted domain without expensive backtracking', () => {
    const value = `maria@${'.'.repeat(32768)} `;
    const startedAt = process.hrtime.bigint();

    const masked = maskScalar(value);

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    expect(masked).toBe('ma***. ');
    expect(elapsedMs).toBeLessThan(150);
  });

  it('should reveal a single leading character between four and six characters', () => {
    expect(maskScalar('Lucas')).toBe('L***');
    expect(maskScalar('Ana2')).toBe('A***');
  });

  it('should fully mask values too short for any reveal', () => {
    expect(maskScalar('SP')).toBe(MASK);
    expect(maskScalar('Ana')).toBe(MASK);
  });

  it('should leave an empty value empty, so the log does not imply content', () => {
    expect(maskScalar('')).toBe('');
  });

  it('should be deterministic so occurrences can be correlated', () => {
    expect(maskScalar('Maria Silva')).toBe(maskScalar('Maria Silva'));
    expect(maskScalar('Maria Silva')).not.toBe(maskScalar('Mario Santos'));
  });

  it('should not allow reconstructing the full value', () => {
    const masked = maskScalar('Maria Silva');

    expect(masked).not.toContain('ria Sil');
    expect(masked.length).toBeLessThan('Maria Silva'.length);
  });

  it('should coerce non-string scalars', () => {
    expect(maskScalar(12345678909)).toBe('12***09');
    expect(maskScalar(true)).toBe('t***');
  });
});
