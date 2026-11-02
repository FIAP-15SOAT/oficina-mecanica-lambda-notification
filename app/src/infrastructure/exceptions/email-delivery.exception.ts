import { InfrastructureException } from './infrastructure.exception';

// No cause: the SMTP server reply can repeat the recipient address
export class EmailDeliveryException extends InfrastructureException {
  constructor() {
    super('Falha no envio do e-mail pelo servidor SMTP');
  }
}
