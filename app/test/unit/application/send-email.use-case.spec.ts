import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { SendEmailUseCase } from '@application/use-cases/notification/send-email.use-case';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

import { createMockEmailSender, VALID_PAYLOAD } from '../../helpers/notification-mock.factory';

describe('SendEmailUseCase', () => {
  let useCase: SendEmailUseCase;
  let emailSender: jest.Mocked<IEmailSender>;

  beforeEach(() => {
    emailSender = createMockEmailSender();

    useCase = new SendEmailUseCase(emailSender);
  });

  it('should send the validated message through the email sender', async () => {
    await useCase.execute(VALID_PAYLOAD);

    expect(emailSender.send).toHaveBeenCalledTimes(1);

    expect(emailSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: VALID_PAYLOAD.to,
        subject: VALID_PAYLOAD.subject,
        text: VALID_PAYLOAD.text,
        html: VALID_PAYLOAD.html,
      }),
    );
  });

  it('should not call the email sender when the message is invalid', async () => {
    await expect(useCase.execute({ ...VALID_PAYLOAD, to: [] })).rejects.toThrow(
      DomainValidationException,
    );

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('should propagate the email sender failure', async () => {
    const failure = new Error('down');
    emailSender.send.mockRejectedValue(failure);

    await expect(useCase.execute(VALID_PAYLOAD)).rejects.toBe(failure);
  });
});
