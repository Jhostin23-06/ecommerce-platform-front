import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { OrdersModule } from '../orders/orders.module';
import { InternalJobsController } from './internal-jobs.controller';

@Module({
  imports: [BillingModule, OrdersModule],
  controllers: [InternalJobsController],
})
export class InternalJobsModule {}
