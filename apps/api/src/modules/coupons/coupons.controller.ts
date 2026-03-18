import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

type ActorRequest = {
  user: {
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get('public')
  listPublic(@Query('tenantId') tenantId: string) {
    return this.couponsService.listPublicPromotions(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Post()
  create(@Body() createCouponDto: CreateCouponDto, @Req() req: ActorRequest) {
    return this.couponsService.create(createCouponDto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Get()
  list(@Query() query: ListCouponsDto, @Req() req: ActorRequest) {
    return this.couponsService.list(query, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateCouponDto: UpdateCouponDto,
    @Req() req: ActorRequest,
  ) {
    return this.couponsService.update(id, updateCouponDto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: ActorRequest) {
    return this.couponsService.delete(id, req.user);
  }
}
