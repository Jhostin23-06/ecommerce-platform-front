import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  buildAccountActivationEmailTemplate,
  buildPasswordResetEmailTemplate,
  buildVerificationEmailTemplate,
} from './email-templates';

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly enabled: boolean;
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled = (this.configService.get<string>('MAIL_ENABLED') ?? 'false').toLowerCase() === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendVerificationEmail(payload: {
    toEmail: string;
    fullName: string;
    token: string;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const verificationUrl = `${this.getWebAppUrl()}/verificar-email?token=${encodeURIComponent(payload.token)}`;
    const appName = this.getAppName();
    const template = buildVerificationEmailTemplate({
      fullName: payload.fullName,
      verificationUrl,
      appName,
    });

    await this.sendMail(payload.toEmail, template.subject, template.text, template.html);
  }

  async sendPasswordResetEmail(payload: {
    toEmail: string;
    fullName: string;
    token: string;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const resetUrl = `${this.getWebAppUrl()}/restablecer-contrasena?token=${encodeURIComponent(payload.token)}`;
    const appName = this.getAppName();
    const template = buildPasswordResetEmailTemplate({
      fullName: payload.fullName,
      resetUrl,
      appName,
    });

    await this.sendMail(payload.toEmail, template.subject, template.text, template.html);
  }

  async sendAccountActivationEmail(payload: {
    toEmail: string;
    fullName: string;
    token: string;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const activationUrl = `${this.getWebAppUrl()}/activar-cuenta?token=${encodeURIComponent(payload.token)}`;
    const appName = this.getAppName();
    const template = buildAccountActivationEmailTemplate({
      fullName: payload.fullName,
      activationUrl,
      appName,
    });

    await this.sendMail(payload.toEmail, template.subject, template.text, template.html);
  }

  private async sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
    const transporter = this.getTransporter();
    const from = this.getFromAddress();

    try {
      await transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
    } catch (error) {
      this.logger.error(`Fallo el envio de correo a ${to}: ${(error as Error).message}`);
      throw new InternalServerErrorException('Fallo el envio del correo');
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? '465');
    const secure = (this.configService.get<string>('SMTP_SECURE') ?? 'true').toLowerCase() === 'true';
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!host || !user || !pass || Number.isNaN(port) || port <= 0) {
      throw new InternalServerErrorException('La configuracion SMTP esta incompleta');
    }

    this.transporter = createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    return this.transporter;
  }

  private getFromAddress(): string {
    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL') || this.configService.get<string>('SMTP_USER');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME') || this.getAppName();

    if (!fromEmail) {
      throw new InternalServerErrorException('Debes configurar SMTP_FROM_EMAIL o SMTP_USER');
    }

    return `${fromName} <${fromEmail}>`;
  }

  private getWebAppUrl(): string {
    return this.configService.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }

  private getAppName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Ecommerce Platform';
  }
}
