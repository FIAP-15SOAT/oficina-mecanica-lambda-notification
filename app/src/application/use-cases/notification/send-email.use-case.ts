import { SendEmailInputDto } from '@application/ports/input/notification/dto/send-email.dto';
import { ISendEmailUseCase } from '@application/ports/input/notification/send-email.use-case.interface';
import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { EmailMessage } from '@domain/value-objects/email-message.vo';

export class SendEmailUseCase implements ISendEmailUseCase {
  constructor(private readonly emailSender: IEmailSender) {}

  async execute(input: SendEmailInputDto): Promise<void> {
    await this.emailSender.send(EmailMessage.create(input));
  }
}
