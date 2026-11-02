import { DomainValidationException } from '../exceptions/domain-validation.exception';

// One bare address per entry: a list or a display name inside an entry would reach the SMTP envelope as is
const EMAIL_ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface EmailMessageProps {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export class EmailMessage {
  private constructor(
    public readonly to: readonly string[],
    public readonly subject: string,
    public readonly text: string,
    public readonly html: string,
  ) {}

  static create(input: EmailMessageProps): EmailMessage {
    if (input.to.length === 0) {
      throw new DomainValidationException('Informe ao menos um destinatário');
    }

    if (!input.to.every((address) => EMAIL_ADDRESS.test(address))) {
      throw new DomainValidationException('Destinatário com endereço de e-mail inválido');
    }

    EmailMessage.requireText(input.subject, 'Informe o assunto do e-mail');
    EmailMessage.requireText(input.text, 'Informe o texto do e-mail');
    EmailMessage.requireText(input.html, 'Informe o HTML do e-mail');

    return new EmailMessage([...input.to], input.subject, input.text, input.html);
  }

  private static requireText(value: string, message: string): void {
    if (value.trim().length === 0) {
      throw new DomainValidationException(message);
    }
  }
}
