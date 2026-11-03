import { ISendEmailUseCase } from '@application/ports/input/notification/send-email.use-case.interface';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { SendEmailController } from '@interface-adapters/notification/send-email.controller';

import { VALID_PAYLOAD } from '../../helpers/notification-mock.factory';

describe('SendEmailController', () => {
  let controller: SendEmailController;
  let useCase: jest.Mocked<ISendEmailUseCase>;

  beforeEach(() => {
    useCase = { execute: jest.fn().mockResolvedValue(undefined) };

    controller = new SendEmailController(useCase);
  });

  it('should return sent when the use case resolves', async () => {
    const result = await controller.send(VALID_PAYLOAD);

    expect(useCase.execute).toHaveBeenCalledWith(VALID_PAYLOAD);
    expect(result).toEqual({ outcome: 'sent' });
  });

  it('should return invalid_message without the error when the message breaks a domain rule', async () => {
    useCase.execute.mockRejectedValue(new DomainValidationException('Informe o assunto do e-mail'));

    const result = await controller.send(VALID_PAYLOAD);

    expect(result).toEqual({ outcome: 'failed', failureReason: 'invalid_message' });
  });

  it('should return smtp_error with the error when the use case fails otherwise', async () => {
    const failure = new Error('connection refused');
    useCase.execute.mockRejectedValue(failure);

    const result = await controller.send(VALID_PAYLOAD);

    expect(result).toEqual({ outcome: 'failed', failureReason: 'smtp_error', error: failure });
  });
});
