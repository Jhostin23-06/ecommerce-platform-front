import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { OrderReturnStatus } from './order-return.entity';

@Injectable()
export class ReturnEmailService {
  private readonly logger = new Logger(ReturnEmailService.name);
  private readonly enabled: boolean;
  private transporter: Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const mailEnabled = (this.configService.get<string>('MAIL_ENABLED') ?? 'false').toLowerCase() === 'true';
    const returnEmailsEnabled =
      (this.configService.get<string>('MAIL_RETURN_EVENTS_ENABLED') ?? 'true').toLowerCase() === 'true';
    this.enabled = mailEnabled && returnEmailsEnabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendReturnStatusChangedEmail(payload: {
    toEmail: string;
    fullName: string;
    orderId: string;
    returnId: string;
    status: OrderReturnStatus;
    reason: string;
    adminNote: string | null;
    requestedAmount: string | null;
    refundAmount: string | null;
    currency: string;
    pickupCourierName: string | null;
    pickupCourierPhone: string | null;
    pickupScheduledAt: Date | null;
    pickupCompletedAt: Date | null;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const appName = this.getAppName();
    const ordersUrl = `${this.getWebAppUrl()}/mis-pedidos`;
    const orderRef = payload.orderId.slice(0, 8);
    const humanStatus = this.toHumanStatus(payload.status);
    const subject = `Actualizacion de devolucion #${orderRef} - ${humanStatus}`;

    const textLines = [
      `Hola ${payload.fullName},`,
      '',
      `Tu solicitud de devolucion del pedido #${orderRef} ahora esta en estado: ${humanStatus}.`,
      `Motivo: ${payload.reason}`,
    ];

    if (payload.requestedAmount) {
      textLines.push(`Monto solicitado: ${payload.requestedAmount} ${payload.currency}`);
    }
    if (payload.refundAmount) {
      textLines.push(`Monto reembolsado: ${payload.refundAmount} ${payload.currency}`);
    }
    if (payload.pickupCourierName || payload.pickupCourierPhone) {
      textLines.push(
        `Repartidor de recojo: ${payload.pickupCourierName ?? '-'} ${payload.pickupCourierPhone ? `(${payload.pickupCourierPhone})` : ''}`.trim(),
      );
    }
    if (payload.pickupScheduledAt) {
      textLines.push(`Recojo programado: ${payload.pickupScheduledAt.toISOString()}`);
    }
    if (payload.pickupCompletedAt) {
      textLines.push(`Recojo completado: ${payload.pickupCompletedAt.toISOString()}`);
    }
    if (payload.adminNote) {
      textLines.push(`Nota del equipo: ${payload.adminNote}`);
    }

    textLines.push('', `Puedes revisar el detalle aqui: ${ordersUrl}`, '', appName);

    const html = `
      <p>Hola ${this.escapeHtml(payload.fullName)},</p>
      <p>
        Tu solicitud de devolucion del pedido <strong>#${orderRef}</strong> ahora esta en estado:
        <strong>${this.escapeHtml(humanStatus)}</strong>.
      </p>
      <p><strong>Motivo:</strong> ${this.escapeHtml(payload.reason)}</p>
      ${payload.requestedAmount ? `<p><strong>Monto solicitado:</strong> ${this.escapeHtml(payload.requestedAmount)} ${this.escapeHtml(payload.currency)}</p>` : ''}
      ${payload.refundAmount ? `<p><strong>Monto reembolsado:</strong> ${this.escapeHtml(payload.refundAmount)} ${this.escapeHtml(payload.currency)}</p>` : ''}
      ${
        payload.pickupCourierName || payload.pickupCourierPhone
          ? `<p><strong>Repartidor de recojo:</strong> ${this.escapeHtml(payload.pickupCourierName ?? '-')} ${payload.pickupCourierPhone ? `(${this.escapeHtml(payload.pickupCourierPhone)})` : ''}</p>`
          : ''
      }
      ${payload.pickupScheduledAt ? `<p><strong>Recojo programado:</strong> ${this.escapeHtml(payload.pickupScheduledAt.toISOString())}</p>` : ''}
      ${payload.pickupCompletedAt ? `<p><strong>Recojo completado:</strong> ${this.escapeHtml(payload.pickupCompletedAt.toISOString())}</p>` : ''}
      ${payload.adminNote ? `<p><strong>Nota del equipo:</strong> ${this.escapeHtml(payload.adminNote)}</p>` : ''}
      <p>Puedes revisar el detalle aqui: <a href="${ordersUrl}">${ordersUrl}</a></p>
      <p>${this.escapeHtml(appName)}</p>
    `;

    await this.sendMail(payload.toEmail, subject, textLines.join('\n'), html);
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
      this.logger.warn('La configuracion SMTP esta incompleta. Return emails will be skipped.');
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

  private toHumanStatus(status: OrderReturnStatus): string {
    if (status === OrderReturnStatus.REQUESTED) return 'solicitada';
    if (status === OrderReturnStatus.APPROVED) return 'aprobada';
    if (status === OrderReturnStatus.PICKUP_PENDING) return 'recojo pendiente';
    if (status === OrderReturnStatus.PICKUP_ASSIGNED) return 'recojo asignado';
    if (status === OrderReturnStatus.PICKED_UP) return 'producto recogido';
    if (status === OrderReturnStatus.RECEIVED) return 'producto recibido en almacen';
    if (status === OrderReturnStatus.REJECTED) return 'rechazada';
    if (status === OrderReturnStatus.REFUNDED) return 'reembolsada';
    return status;
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
