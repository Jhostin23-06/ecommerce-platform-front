import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreatePickupPointDto } from './dto/create-pickup-point.dto';
import { ListPickupPointsDto } from './dto/list-pickup-points.dto';
import { UpdatePickupPointDto } from './dto/update-pickup-point.dto';
import { PickupPointsService } from './pickup-points.service';

type ActorRequest = {
  user: {
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('pickup-points')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PickupPointsController {
  constructor(private readonly pickupPointsService: PickupPointsService) {}

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get()
  list(@Query() query: ListPickupPointsDto, @Req() req: ActorRequest) {
    return this.pickupPointsService.list(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Post()
  create(@Body() createPickupPointDto: CreatePickupPointDto, @Req() req: ActorRequest) {
    return this.pickupPointsService.create(createPickupPointDto, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updatePickupPointDto: UpdatePickupPointDto,
    @Req() req: ActorRequest,
  ) {
    return this.pickupPointsService.update(id, updatePickupPointDto, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER)
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: ActorRequest) {
    return this.pickupPointsService.delete(id, req.user);
  }
}
