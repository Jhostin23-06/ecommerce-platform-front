import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreateOrderReturnDto } from './dto/create-order-return.dto';
import { ListTenantReturnsDto } from './dto/list-tenant-returns.dto';
import { UpdateOrderReturnStatusDto } from './dto/update-order-return-status.dto';
import { ReturnsService } from './returns.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
    email: string;
  };
};

@Controller('returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Post()
  create(@Req() req: ActorRequest, @Body() createOrderReturnDto: CreateOrderReturnDto) {
    return this.returnsService.createReturn(req.user, createOrderReturnDto);
  }

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get('me')
  listMy(@Req() req: ActorRequest) {
    return this.returnsService.listMyReturns(req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Get('tenant')
  listTenant(@Req() req: ActorRequest, @Query() query: ListTenantReturnsDto) {
    return this.returnsService.listTenantReturns(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Patch(':id/status')
  updateStatus(
    @Req() req: ActorRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateOrderReturnStatusDto: UpdateOrderReturnStatusDto,
  ) {
    return this.returnsService.updateStatus(id, updateOrderReturnStatusDto, req.user);
  }
}
