import { maskScalar } from './pii-masker';

export const REDACTED = '[REDACTED]';
export const MAX_TEXT_LENGTH = 2048;
export const MAX_STACKTRACE_LENGTH = 8192;

interface NamedPattern {
  name: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: readonly NamedPattern[] = [
  {
    name: 'jwt',
    pattern:
      /(?<![A-Za-z0-9_-])(?=([A-Za-z0-9_-]{10,}))\1\.(?=([A-Za-z0-9_-]{10,}))\2\.(?=([A-Za-z0-9_-]{10,}))\3/g,
  },
  {
    name: 'auth-scheme',
    pattern: /\b(?:Bearer|Basic|Digest|Token|ApiKey)\s+[a-z0-9._~+/=-]{8,}/gi,
  },
  // URL with embedded user:password, such as a connection string
  // (`smtp://user:password@host`) quoted in a library error message.
  //
  // The password excludes `/`, `?` and `#` because RFC 3986 requires them to be
  // percent-encoded inside userinfo. Without that exclusion the quantifier
  // scanned to the end of the text looking for an `@` that never came, and a
  // repeated run like `a://b:` cost O(n²) — 12.6 ms at 8 KB. With it, the next
  // run's `://` ends the previous scan, and the cost becomes linear.
  {
    name: 'url-credentials',
    pattern: /(?<![A-Za-z0-9+.-])[a-zA-Z](?=([a-zA-Z0-9+.-]*))\1:\/\/[^\s:/@]+:[^\s@/?#]+@\S+/g,
  },
  // Sensitive key=value pair in a query string or connection string.
  { name: 'key-value', pattern: /\b(?:password|pwd|secret|api[_-]?key)=[^;&\s]+/gi },
];

const PII_PATTERNS: readonly NamedPattern[] = [
  { name: 'cnpj-formatted', pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
  { name: 'cpf-formatted', pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { name: 'cnpj-digits', pattern: /\b\d{14}\b/g },
  { name: 'cpf-digits', pattern: /\b\d{11}\b/g },
  {
    name: 'email',
    pattern:
      /(?<![A-Za-z0-9._%+-])(?=([A-Za-z0-9._%+-]+))\1@(?=([A-Za-z0-9-]+))\2\.(?=([A-Za-z0-9.-]+))\3/g,
  },
  { name: 'phone-parenthesized', pattern: /\(\d{2}\)\s?\d{4,5}-\d{4}/g },
  { name: 'phone-spaced', pattern: /\b\d{2}\s\d{4,5}-\d{4}\b/g },
];

export function truncateText(value: string, maxLength: number = MAX_TEXT_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Scans free text for sensitive content the field name did not catch — exception
 * message, stack trace, user-agent. A secret is removed; PII is masked
 * preserving its shape.
 */
export function sanitizeText(value: string, maxLength: number = MAX_TEXT_LENGTH): string {
  const bounded = truncateText(value, maxLength);

  const withoutSecrets = SECRET_PATTERNS.reduce(
    (text, { pattern }) => text.replace(pattern, REDACTED),
    bounded,
  );

  return PII_PATTERNS.reduce(
    (text, { pattern }) => text.replace(pattern, (match) => maskScalar(match)),
    withoutSecrets,
  );
}

export function sanitizeStackTrace(value: string): string {
  return sanitizeText(value, MAX_STACKTRACE_LENGTH);
}
