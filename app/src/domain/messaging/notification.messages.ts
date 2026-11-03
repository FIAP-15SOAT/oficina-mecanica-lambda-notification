// Copied from FIAP-15SOAT/oficina-mecanica-work-order-service@b9299875 app/src/domain/messaging/notification.messages.ts. Do not edit here.
export interface NotificationMessagePayloads {
  'notification.email.send': {
    to: string[];
    subject: string;
    text: string;
    html: string;
    // Lowercase snake_case e-mail label; the notification function logs it, never the subject
    purpose?: string;
  };
}
