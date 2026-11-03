import { IEmailSender } from '@application/ports/output/email-sender.service.interface';
import { NotificationMessagePayloads } from '@domain/messaging/notification.messages';

export const RECIPIENT = 'maria@example.com';
export const SENDER = 'Oficina Mecânica <noreply@oficina.local>';

export const VALID_PAYLOAD: NotificationMessagePayloads['notification.email.send'] = {
  to: [RECIPIENT],
  subject: 'Sua conta na Oficina Mecânica foi criada',
  text: 'Olá, Maria. Senha inicial: Tmp#4821',
  html: '<p>Olá, Maria. Senha inicial: <strong>Tmp#4821</strong></p>',
  purpose: 'staff_initial_password',
};

export function createMockEmailSender(): jest.Mocked<IEmailSender> {
  return { send: jest.fn().mockResolvedValue(undefined) };
}
