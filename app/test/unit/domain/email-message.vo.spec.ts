import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';
import { EmailMessage } from '@domain/value-objects/email-message.vo';

import { RECIPIENT, VALID_PAYLOAD } from '../../helpers/notification-mock.factory';

describe('EmailMessage', () => {
  it('should keep the recipients, subject, text and html unchanged', () => {
    const message = EmailMessage.create(VALID_PAYLOAD);

    expect(message.to).toEqual(VALID_PAYLOAD.to);
    expect(message.subject).toBe(VALID_PAYLOAD.subject);
    expect(message.text).toBe(VALID_PAYLOAD.text);
    expect(message.html).toBe(VALID_PAYLOAD.html);
  });

  it('should reject an empty recipient list', () => {
    expect(() => EmailMessage.create({ ...VALID_PAYLOAD, to: [] })).toThrow(
      new DomainValidationException('Informe ao menos um destinatário'),
    );
  });

  it.each([
    'a@b.com, c@d.com',
    'a@b.com;c@d.com',
    'Maria <maria@example.com>',
    'maria@example',
    'maria example@x.com',
    '',
  ])('should reject the recipient address %p', (address) => {
    expect(() => EmailMessage.create({ ...VALID_PAYLOAD, to: [RECIPIENT, address] })).toThrow(
      new DomainValidationException('Destinatário com endereço de e-mail inválido'),
    );
  });

  it.each([
    ['subject', 'Informe o assunto do e-mail'],
    ['text', 'Informe o texto do e-mail'],
    ['html', 'Informe o HTML do e-mail'],
  ])('should reject a blank %s', (field, message) => {
    expect(() => EmailMessage.create({ ...VALID_PAYLOAD, [field]: '   ' })).toThrow(
      new DomainValidationException(message),
    );
  });
});
