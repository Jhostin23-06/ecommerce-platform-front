import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentTransaction, PaymentRefund]), OrdersModule, BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService, TypeOrmModule],
})
export class PaymentsModule {}
