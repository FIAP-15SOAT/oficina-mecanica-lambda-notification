import { SendEmailInputDto } from '@application/ports/input/notification/dto/send-email.dto';

export interface ISendEmailUseCase {
  execute(input: SendEmailInputDto): Promise<void>;
}
