import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { OrderStatusHistory } from '../orders/order-status-history.entity';
import { Order } from '../orders/order.entity';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderReturn } from './order-return.entity';
import { ReturnEmailService } from './return-email.service';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

@Module({
  imports: [TypeOrmModule.forFeature([OrderReturn, Order, OrderStatusHistory, User]), OrdersModule, PaymentsModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnEmailService],
  exports: [ReturnsService, TypeOrmModule],
})
export class ReturnsModule {}
