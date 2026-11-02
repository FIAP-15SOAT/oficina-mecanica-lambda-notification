import { createTransport, Transporter } from 'nodemailer';

import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { EmailMessage } from '@domain/value-objects/email-message.vo';
import { Environment } from '@infrastructure/config/environment';
import { EmailDeliveryException } from '@infrastructure/exceptions/email-delivery.exception';

// Fails within the 5 s function timeout, leaving time to report the batch item failure
export const SMTP_TIMEOUT_MS = 2000;

export class SmtpEmailSender implements IEmailSender {
  constructor(
    private readonly transporter: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  static create(
    environment: Pick<Environment, 'SMTP_HOST' | 'SMTP_PORT' | 'MAIL_FROM'>,
  ): SmtpEmailSender {
    const transporter = createTransport({
      host: environment.SMTP_HOST,
      port: environment.SMTP_PORT,
      // The in-cluster relay listens in plain text behind the internal load balancer
      secure: false,
      ignoreTLS: true,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });

    return new SmtpEmailSender(transporter, environment.MAIL_FROM);
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: [...message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch {
      throw new EmailDeliveryException();
    }
  }
}
