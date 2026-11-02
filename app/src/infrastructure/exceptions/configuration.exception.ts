import { InfrastructureException } from './infrastructure.exception';

export class ConfigurationException extends InfrastructureException {
  constructor(message: string) {
    super(message);
  }
}
