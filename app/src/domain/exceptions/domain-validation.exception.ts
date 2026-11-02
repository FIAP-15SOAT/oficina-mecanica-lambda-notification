import { DomainException } from './domain.exception';

export class DomainValidationException extends DomainException {
  constructor(message: string) {
    super(message);
  }
}
