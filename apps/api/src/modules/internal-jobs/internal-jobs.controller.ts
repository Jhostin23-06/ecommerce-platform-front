import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../billing/billing.service';
import { OrderLifecycleStatus } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import {
  ProcessBillingIssueCreditNoteJobDto,
  ProcessBillingIssueOrderDocumentJobDto,
  ProcessOrderPaidEmailJobDto,
  ProcessOrderStatusChangedEmailJobDto,
} from './dto/process-jobs.dto';

@Controller('internal/jobs')
export class InternalJobsController {
  constructor(
    private readonly configService: ConfigService,
    private readonly billingService: BillingService,
    private readonly ordersService: OrdersService,
  ) {}

  @Post('billing/issue-order-document')
  async issueOrderDocument(
    @Headers('x-worker-token') workerToken: string | undefined,
    @Body() payload: ProcessBillingIssueOrderDocumentJobDto,
  ): Promise<{ ok: true; issued: boolean }> {
    this.assertWorkerToken(workerToken);
    const document = await this.billingService.issueDocumentForPaidOrder(payload.orderId, payload.trigger ?? 'queue');
    return { ok: true, issued: Boolean(document) };
  }

  @Post('billing/issue-credit-note')
  async issueCreditNote(
    @Headers('x-worker-token') workerToken: string | undefined,
    @Body() payload: ProcessBillingIssueCreditNoteJobDto,
  ): Promise<{ ok: true; issued: boolean }> {
    this.assertWorkerToken(workerToken);
    const document = await this.billingService.issueCreditNoteForRefund({
      tenantId: payload.tenantId,
      orderId: payload.orderId,
      refundId: payload.refundId,
      amount: payload.amount,
      currency: payload.currency,
      reason: payload.reason ?? null,
      trigger: payload.trigger ?? 'queue',
    });
    return { ok: true, issued: Boolean(document) };
  }

  @Post('notifications/order-paid-email')
  async sendOrderPaidEmail(
    @Headers('x-worker-token') workerToken: string | undefined,
    @Body() payload: ProcessOrderPaidEmailJobDto,
  ): Promise<{ ok: true }> {
    this.assertWorkerToken(workerToken);
    await this.ordersService.dispatchOrderPaidEmail(payload.orderId);
    return { ok: true };
  }

  @Post('notifications/order-status-changed-email')
  async sendOrderStatusChangedEmail(
    @Headers('x-worker-token') workerToken: string | undefined,
    @Body() payload: ProcessOrderStatusChangedEmailJobDto,
  ): Promise<{ ok: true }> {
    this.assertWorkerToken(workerToken);
    await this.ordersService.dispatchOrderStatusChangedEmail(
      payload.orderId,
      payload.previousStatus as OrderLifecycleStatus,
      payload.nextStatus as OrderLifecycleStatus,
    );
    return { ok: true };
  }

  private assertWorkerToken(value: string | undefined): void {
    const expected = this.configService.get<string>('WORKER_JOB_TOKEN') ?? 'dev-worker-token';

    if (!value || value !== expected) {
      throw new UnauthorizedException('No autorizado');
    }
  }
}
