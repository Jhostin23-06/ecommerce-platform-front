import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../src/modules/payments/payments.service';

describe('PaymentsService webhook guard', () => {
  it('fails in production when STRIPE_WEBHOOK_SECRET is missing', async () => {
    const configService = new ConfigService({
      NODE_ENV: 'production',
      STRIPE_WEBHOOK_SECRET: '',
    });

    const ordersService = {} as any;
    const billingService = {} as any;
    const paymentsRepository = {} as any;
    const refundsRepository = {} as any;
    const dataSource = {} as any;
    const jobsQueueService = {} as any;

    const service = new PaymentsService(
      configService,
      ordersService,
      billingService,
      paymentsRepository,
      refundsRepository,
      dataSource,
      jobsQueueService,
    );

    await expect(service.handleStripeWebhook({ type: 'checkout.session.completed' }, undefined)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
