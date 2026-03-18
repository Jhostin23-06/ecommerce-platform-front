import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { OrderLifecycleStatus } from './order.entity';

@Injectable()
export class OrderEmailService {
  private readonly logger = new Logger(OrderEmailService.name);
  private readonly enabled: boolean;
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled = (this.configService.get<string>('MAIL_ENABLED') ?? 'false').toLowerCase() === 'true';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendOrderPaidEmail(payload: {
    toEmail: string;
    fullName: string;
    orderId: string;
    total: string;
    currency: string;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const appName = this.getAppName();
    const ordersUrl = `${this.getWebAppUrl()}/mis-pedidos`;
    const orderRef = payload.orderId.slice(0, 8);
    const subject = `Pago confirmado - Pedido #${orderRef}`;
    const text = [
      `Hola ${payload.fullName},`,
      '',
      `Confirmamos el pago de tu pedido #${orderRef}.`,
      `Total: ${payload.total} ${payload.currency}.`,
      '',
      `Puedes revisar el estado aqui: ${ordersUrl}`,
      '',
      `${appName}`,
    ].join('\n');
    const html = `
      <p>Hola ${this.escapeHtml(payload.fullName)},</p>
      <p>Confirmamos el pago de tu pedido <strong>#${orderRef}</strong>.</p>
      <p><strong>Total:</strong> ${this.escapeHtml(payload.total)} ${this.escapeHtml(payload.currency)}</p>
      <p>Puedes revisar el estado aqui: <a href="${ordersUrl}">${ordersUrl}</a></p>
      <p>${this.escapeHtml(appName)}</p>
    `;

    await this.sendMail(payload.toEmail, subject, text, html);
  }

  async sendOrderStatusChangedEmail(payload: {
    toEmail: string;
    fullName: string;
    orderId: string;
    previousStatus: OrderLifecycleStatus | null;
    nextStatus: OrderLifecycleStatus;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const appName = this.getAppName();
    const ordersUrl = `${this.getWebAppUrl()}/mis-pedidos`;
    const orderRef = payload.orderId.slice(0, 8);
    const humanStatus = this.toHumanStatus(payload.nextStatus);
    const subject = `Actualizacion de pedido #${orderRef} - ${humanStatus}`;
    const text = [
      `Hola ${payload.fullName},`,
      '',
      `Tu pedido #${orderRef} ahora esta: ${humanStatus}.`,
      '',
      `Puedes revisar el detalle aqui: ${ordersUrl}`,
      '',
      `${appName}`,
    ].join('\n');
    const html = `
      <p>Hola ${this.escapeHtml(payload.fullName)},</p>
      <p>Tu pedido <strong>#${orderRef}</strong> ahora esta: <strong>${this.escapeHtml(humanStatus)}</strong>.</p>
      <p>Puedes revisar el detalle aqui: <a href="${ordersUrl}">${ordersUrl}</a></p>
      <p>${this.escapeHtml(appName)}</p>
    `;

    await this.sendMail(payload.toEmail, subject, text, html);
  }

  private async sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
    const transporter = this.getTransporter();
    const from = this.getFromAddress();
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
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
      this.logger.warn('La configuracion SMTP esta incompleta. Order emails will be skipped.');
      return createTransport({ jsonTransport: true });
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
      return `${fromName} <no-reply@example.com>`;
    }

    return `${fromName} <${fromEmail}>`;
  }

  private getWebAppUrl(): string {
    return this.configService.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
  }

  private getAppName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Ecommerce Platform';
  }

  private toHumanStatus(status: OrderLifecycleStatus): string {
    switch (status) {
      case OrderLifecycleStatus.PENDING:
        return 'pendiente';
      case OrderLifecycleStatus.PAID:
        return 'pagado';
      case OrderLifecycleStatus.PREPARING:
        return 'preparando';
      case OrderLifecycleStatus.SHIPPED:
        return 'enviado';
      case OrderLifecycleStatus.DELIVERED:
        return 'entregado';
      case OrderLifecycleStatus.CANCELLED:
        return 'cancelado';
      default:
        return status;
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
