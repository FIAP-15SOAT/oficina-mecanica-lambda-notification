export interface SendEmailInputDto {
  to: string[];
  subject: string;
  text: string;
  html: string;
}
