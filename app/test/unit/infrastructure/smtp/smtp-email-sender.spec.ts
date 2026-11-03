import { createTransport } from 'nodemailer';

import { EmailMessage } from '@domain/value-objects/email-message.vo';
import { EmailDeliveryException } from '@infrastructure/exceptions/email-delivery.exception';
import { SmtpEmailSender } from '@infrastructure/smtp/smtp-email-sender';

import { RECIPIENT, SENDER, VALID_PAYLOAD } from '../../../helpers/notification-mock.factory';

jest.mock('nodemailer');

describe('SmtpEmailSender', () => {
  let sender: SmtpEmailSender;
  // Typed loosely: jest.Mocked picks the callback overload of sendMail, which returns void
  let transporter: { sendMail: jest.Mock };

  beforeEach(() => {
    transporter = { sendMail: jest.fn().mockResolvedValue({}) };

    sender = new SmtpEmailSender(transporter, SENDER);
  });

  it('should build a transport without tls, with 2 s timeouts and without file or url content', () => {
    SmtpEmailSender.create({ SMTP_HOST: 'mailhog.internal', SMTP_PORT: 1025, MAIL_FROM: SENDER });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'mailhog.internal',
      port: 1025,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 2000,
      greetingTimeout: 2000,
      socketTimeout: 2000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it('should send the message unchanged from the configured sender', async () => {
    await sender.send(EmailMessage.create(VALID_PAYLOAD));

    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: SENDER,
      to: [RECIPIENT],
      subject: VALID_PAYLOAD.subject,
      text: VALID_PAYLOAD.text,
      html: VALID_PAYLOAD.html,
    });
  });

  it('should replace the smtp error with a delivery exception without the server text', async () => {
    transporter.sendMail.mockRejectedValue(
      new Error('550 5.1.1 <maria@example.com>: Recipient address rejected'),
    );

    const failure = await sender
      .send(EmailMessage.create(VALID_PAYLOAD))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(EmailDeliveryException);
    expect((failure as Error).message).toBe('Falha no envio do e-mail pelo servidor SMTP');
    expect((failure as Error).cause).toBeUndefined();
  });
});
