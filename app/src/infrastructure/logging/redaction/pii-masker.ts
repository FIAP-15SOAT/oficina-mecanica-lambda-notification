export const MASK = '***';

const REVEALED_EDGE_LENGTH = 2;

const MIN_TWO_EDGE_LENGTH = 7;
const MIN_SINGLE_EDGE_LENGTH = 4;

const MAX_REVEALED_IDENTIFIER_CHARS = 5;

const ALPHANUMERIC_RUN = /[\p{L}\p{N}]+/gu;

export function maskScalar(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value);

  if (text.length === 0) {
    return text;
  }

  if (isEmailShape(text)) {
    return maskEmail(text);
  }

  if (isFormattedIdentifier(text)) {
    return maskFormattedIdentifier(text);
  }

  return maskFreeText(text);
}

function isEmailShape(value: string): boolean {
  const separator = value.indexOf('@');

  if (separator < 1 || separator !== value.lastIndexOf('@') || /\s/.test(value)) {
    return false;
  }

  // The dot needs at least one domain character on each side.
  const dot = value.indexOf('.', separator + 2);

  return dot !== -1 && dot < value.length - 1;
}

function maskEmail(value: string): string {
  const separator = value.lastIndexOf('@');

  return `${maskFreeText(value.slice(0, separator))}${value.slice(separator)}`;
}

function maskFreeText(value: string): string {
  if (value.length < MIN_SINGLE_EDGE_LENGTH) {
    return MASK;
  }

  if (value.length < MIN_TWO_EDGE_LENGTH) {
    return `${value.slice(0, 1)}${MASK}`;
  }

  return `${value.slice(0, REVEALED_EDGE_LENGTH)}${MASK}${value.slice(-REVEALED_EDGE_LENGTH)}`;
}

/**
 * A formatted identifier is a value made only of numeric blocks separated by
 * punctuation — CPF, CNPJ, CEP, phone. Masking it with the free-text rule
 * (`12***09`) would destroy the shape and nobody would recognize what the field
 * was anymore.
 */
function isFormattedIdentifier(value: string): boolean {
  const runs = findAlphanumericRuns(value);

  return runs.length >= 2 && runs.every((run) => /^\p{N}+$/u.test(run[0]));
}

function maskFormattedIdentifier(value: string): string {
  const runs = findAlphanumericRuns(value);
  const visible = resolveVisibleRuns(runs);
  const characters = [...value];

  runs.forEach((run, index) => {
    if (visible.has(index)) {
      return;
    }

    for (let offset = 0; offset < run[0].length; offset += 1) {
      characters[run.index + offset] = '*';
    }
  });

  return characters.join('');
}

/**
 * The last block always shows. The second to last joins it only when both add
 * up to at most 5 characters — that is what produces `***.***.789-09` for a CPF
 * (3 + 2) without revealing too much of a phone, where the second to last block
 * alone already has 5 digits.
 */
function resolveVisibleRuns(runs: RegExpExecArray[]): Set<number> {
  const lastIndex = runs.length - 1;
  const visible = new Set<number>([lastIndex]);

  const combined = runs[lastIndex][0].length + runs[lastIndex - 1][0].length;

  if (combined <= MAX_REVEALED_IDENTIFIER_CHARS) {
    visible.add(lastIndex - 1);
  }

  return visible;
}

function findAlphanumericRuns(value: string): RegExpExecArray[] {
  ALPHANUMERIC_RUN.lastIndex = 0;

  const runs: RegExpExecArray[] = [];
  let match = ALPHANUMERIC_RUN.exec(value);

  while (match !== null) {
    runs.push(match);
    match = ALPHANUMERIC_RUN.exec(value);
  }

  return runs;
}
