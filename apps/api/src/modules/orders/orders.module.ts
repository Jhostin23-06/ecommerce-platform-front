import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { CartModule } from '../cart/cart.module';
import { CouponsModule } from '../coupons/coupons.module';
import { DeliveryZonesModule } from '../delivery-zones/delivery-zones.module';
import { PickupPointsModule } from '../pickup-points/pickup-points.module';
import { BillingDocument } from '../billing/entities/billing-document.entity';
import { BillingSettings } from '../billing/entities/billing-settings.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import { Order } from './order.entity';
import { OrderEmailService } from './order-email.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderStatusHistory,
      Product,
      ProductVariant,
      User,
      BillingDocument,
      BillingSettings,
    ]),
    CartModule,
    CouponsModule,
    PickupPointsModule,
    DeliveryZonesModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEmailService],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
