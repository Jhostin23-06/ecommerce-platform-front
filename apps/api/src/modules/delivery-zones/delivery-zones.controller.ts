import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { ListDeliveryZonesDto } from './dto/list-delivery-zones.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { DeliveryZonesService } from './delivery-zones.service';

type ActorRequest = {
  user: {
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('delivery-zones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryZonesController {
  constructor(private readonly deliveryZonesService: DeliveryZonesService) {}

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get()
  list(@Query() query: ListDeliveryZonesDto, @Req() req: ActorRequest) {
    return this.deliveryZonesService.list(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Post()
  create(@Body() createDeliveryZoneDto: CreateDeliveryZoneDto, @Req() req: ActorRequest) {
    return this.deliveryZonesService.create(createDeliveryZoneDto, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateDeliveryZoneDto: UpdateDeliveryZoneDto,
    @Req() req: ActorRequest,
  ) {
    return this.deliveryZonesService.update(id, updateDeliveryZoneDto, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: ActorRequest) {
    return this.deliveryZonesService.delete(id, req.user);
  }
}
