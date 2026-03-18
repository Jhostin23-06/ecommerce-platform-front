import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../catalog/entities/category.entity';
import { Product } from '../catalog/entities/product.entity';
import { Coupon } from './coupon.entity';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, Product, Category])],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService, TypeOrmModule],
})
export class CouponsModule {}
