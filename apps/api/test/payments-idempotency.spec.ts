import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PaymentsService } from '../src/modules/payments/payments.service';

describe('PaymentsService webhook idempotency', () => {
  it('processes duplicated Stripe event only once', async () => {
    const configService = new ConfigService({
      NODE_ENV: 'development',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: '',
    });

    const order = {
      id: 'order-1',
      tenantId: 'tenant-1',
      total: '25.00',
      currency: 'PEN',
      items: [],
    };

    const ordersService = {
      findOrder: jest.fn().mockResolvedValue(order),
      markOrderAsPaid: jest.fn().mockResolvedValue(order),
    };

    const insertResults = [{ raw: [{ id: 'tx-1' }] }, { raw: [] }];
    const paymentsRepository = {
      createQueryBuilder: jest.fn().mockImplementation(() => {
        let mode: 'insert' | 'update' | 'select' = 'select';

        const builder = {
          insert: jest.fn().mockImplementation(() => {
            mode = 'insert';
            return builder;
          }),
          update: jest.fn().mockImplementation(() => {
            mode = 'update';
            return builder;
          }),
          into: jest.fn().mockImplementation(() => {
            return builder;
          }),
          values: jest.fn().mockImplementation(() => {
            return builder;
          }),
          onConflict: jest.fn().mockImplementation(() => {
            return builder;
          }),
          returning: jest.fn().mockImplementation(() => {
            return builder;
          }),
          set: jest.fn().mockImplementation(() => {
            return builder;
          }),
          where: jest.fn().mockImplementation(() => {
            return builder;
          }),
          andWhere: jest.fn().mockImplementation(() => {
            return builder;
          }),
          execute: jest.fn().mockImplementation(async () => {
            if (mode === 'insert') {
              return insertResults.shift() ?? { raw: [] };
            }
            return { raw: [] };
          }),
        };

        return builder;
      }),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    const refundsRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const billingService = {
      issueDocumentForPaidOrder: jest.fn(),
      issueCreditNoteForRefund: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(),
    };
    const jobsQueueService = {
      enqueueIssueOrderDocument: jest.fn().mockResolvedValue(false),
      enqueueIssueCreditNote: jest.fn().mockResolvedValue(false),
    };

    const service = new PaymentsService(
      configService,
      ordersService as any,
      billingService as any,
      paymentsRepository as any,
      refundsRepository as any,
      dataSource as any,
      jobsQueueService as any,
    );

    const event: Stripe.Event = {
      id: 'evt_1',
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_1',
          object: 'payment_intent',
          metadata: { orderId: 'order-1' },
        } as any,
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: 'req_1',
        idempotency_key: null,
      },
      type: 'payment_intent.succeeded',
    };

    await service.handleStripeWebhook(event, undefined);
    await service.handleStripeWebhook(event, undefined);

    expect(ordersService.markOrderAsPaid).toHaveBeenCalledTimes(1);
  });
});
