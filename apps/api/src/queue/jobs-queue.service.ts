import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import {
  BILLING_JOB_ISSUE_CREDIT_NOTE,
  BILLING_JOB_ISSUE_ORDER_DOCUMENT,
  BILLING_JOBS_QUEUE,
  BillingIssueCreditNoteJob,
  BillingIssueOrderDocumentJob,
  NOTIFICATION_JOB_ORDER_PAID_EMAIL,
  NOTIFICATION_JOB_ORDER_STATUS_CHANGED_EMAIL,
  NOTIFICATIONS_JOBS_QUEUE,
  NotificationOrderPaidEmailJob,
  NotificationOrderStatusChangedEmailJob,
} from './jobs-queue.constants';

@Injectable()
export class JobsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsQueueService.name);
  private readonly enabled: boolean;
  private readonly redisUrl: string;
  private billingQueue: Queue | null = null;
  private notificationsQueue: Queue | null = null;

  constructor(private readonly configService: ConfigService) {
    this.enabled = (this.configService.get<string>('QUEUE_ENABLED') ?? 'true').toLowerCase() === 'true';
    this.redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

    if (!this.enabled) {
      this.logger.warn('QUEUE_ENABLED=false. Los jobs async seran omitidos.');
      return;
    }

    const connection = {
      url: this.redisUrl,
      maxRetriesPerRequest: null as null,
    };
    this.billingQueue = new Queue(BILLING_JOBS_QUEUE, { connection });
    this.notificationsQueue = new Queue(NOTIFICATIONS_JOBS_QUEUE, { connection });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.billingQueue || !this.notificationsQueue) {
      return;
    }

    await Promise.all([this.billingQueue.waitUntilReady(), this.notificationsQueue.waitUntilReady()]);
    this.logger.log(`BullMQ listo en Redis (${this.redisUrl})`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.billingQueue?.close(), this.notificationsQueue?.close()]);
    this.billingQueue = null;
    this.notificationsQueue = null;
  }

  async enqueueIssueOrderDocument(payload: BillingIssueOrderDocumentJob): Promise<boolean> {
    if (!this.billingQueue) {
      return false;
    }

    await this.billingQueue.add(BILLING_JOB_ISSUE_ORDER_DOCUMENT, payload, {
      ...this.defaultJobOptions(),
      jobId: `billing:order-document:${payload.orderId}`,
    });
    return true;
  }

  async enqueueIssueCreditNote(payload: BillingIssueCreditNoteJob): Promise<boolean> {
    if (!this.billingQueue) {
      return false;
    }

    await this.billingQueue.add(BILLING_JOB_ISSUE_CREDIT_NOTE, payload, {
      ...this.defaultJobOptions(),
      jobId: `billing:credit-note:${payload.refundId}`,
    });
    return true;
  }

  async enqueueOrderPaidEmail(payload: NotificationOrderPaidEmailJob): Promise<boolean> {
    if (!this.notificationsQueue) {
      return false;
    }

    await this.notificationsQueue.add(NOTIFICATION_JOB_ORDER_PAID_EMAIL, payload, {
      ...this.defaultJobOptions(),
      jobId: `notifications:order-paid:${payload.orderId}`,
    });
    return true;
  }

  async enqueueOrderStatusChangedEmail(payload: NotificationOrderStatusChangedEmailJob): Promise<boolean> {
    if (!this.notificationsQueue) {
      return false;
    }

    await this.notificationsQueue.add(NOTIFICATION_JOB_ORDER_STATUS_CHANGED_EMAIL, payload, {
      ...this.defaultJobOptions(),
      jobId: `notifications:order-status:${payload.orderId}:${payload.previousStatus}:${payload.nextStatus}`,
    });
    return true;
  }

  private defaultJobOptions(): JobsOptions {
    return {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnComplete: 1_000,
      removeOnFail: 1_000,
    };
  }
}
