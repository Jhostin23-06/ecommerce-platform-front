import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { HealthController } from './health/health.controller';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { DeliveryZonesModule } from './modules/delivery-zones/delivery-zones.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PickupPointsModule } from './modules/pickup-points/pickup-points.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { RedisService } from './config/redis.service';
import { QueueModule } from './queue/queue.module';
import { InternalJobsModule } from './modules/internal-jobs/internal-jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const synchronizeValue = (configService.get<string>('DB_SYNCHRONIZE') ?? 'false').toLowerCase();
        const synchronize = synchronizeValue === 'true';

        return {
        type: 'postgres' as const,
        url:
          configService.get<string>('DATABASE_URL') ??
          'postgresql://ecom_user:ecom_pass@localhost:5433/ecommerce_dev',
        autoLoadEntities: true,
        synchronize,
      };
      },
    }),
    TenantsModule,
    UsersModule,
    AnalyticsModule,
    AuthModule,
    BillingModule,
    CatalogModule,
    CartModule,
    CouponsModule,
    DeliveryZonesModule,
    PickupPointsModule,
    OrdersModule,
    PaymentsModule,
    ReturnsModule,
    QueueModule,
    InternalJobsModule,
  ],
  controllers: [HealthController],
  providers: [RedisService],
})
export class AppModule {}
