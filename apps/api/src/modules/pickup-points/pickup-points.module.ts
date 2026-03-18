import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PickupPoint } from './pickup-point.entity';
import { PickupPointsController } from './pickup-points.controller';
import { PickupPointsService } from './pickup-points.service';

@Module({
  imports: [TypeOrmModule.forFeature([PickupPoint])],
  controllers: [PickupPointsController],
  providers: [PickupPointsService],
  exports: [PickupPointsService, TypeOrmModule],
})
export class PickupPointsModule {}
