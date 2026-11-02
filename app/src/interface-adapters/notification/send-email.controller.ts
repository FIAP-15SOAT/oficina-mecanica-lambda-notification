import { NotificationFailureReason } from '@application/logging/business-event.catalog';
import { SendEmailInputDto } from '@application/ports/input/notification/dto/send-email.dto';
import { ISendEmailUseCase } from '@application/ports/input/notification/send-email.use-case.interface';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

export type SendEmailResult =
  | { outcome: 'sent' }
  | { outcome: 'failed'; failureReason: NotificationFailureReason; error?: unknown };

export class SendEmailController {
  constructor(private readonly sendEmailUseCase: ISendEmailUseCase) {}

  async send(input: SendEmailInputDto): Promise<SendEmailResult> {
    try {
      await this.sendEmailUseCase.execute(input);

      return { outcome: 'sent' };
    } catch (error) {
      // The validation message describes the producer's payload; the reason alone is enough to act on
      return error instanceof DomainValidationException
        ? { outcome: 'failed', failureReason: 'invalid_message' }
        : { outcome: 'failed', failureReason: 'smtp_error', error };
    }
  }
}
