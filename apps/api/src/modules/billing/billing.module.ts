import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Order } from '../orders/order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingDocument } from './entities/billing-document.entity';
import { BillingSettings } from './entities/billing-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BillingSettings, BillingDocument, Order, User, Tenant])],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService, TypeOrmModule],
})
export class BillingModule {}
