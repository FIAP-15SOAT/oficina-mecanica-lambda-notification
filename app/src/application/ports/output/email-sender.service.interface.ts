import { EmailMessage } from '@domain/value-objects/email-message.vo';

export interface IEmailSender {
  send(message: EmailMessage): Promise<void>;
}
