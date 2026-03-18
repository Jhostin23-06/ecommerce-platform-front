import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { ListTenantOrdersDto } from './dto/list-tenant-orders.dto';
import { UpdateFulfillmentStatusDto } from './dto/update-fulfillment-status.dto';
import { OrdersService } from './orders.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Post('preview')
  preview(@Req() req: ActorRequest, @Body() checkoutDto: CheckoutDto) {
    return this.ordersService.previewCheckout(req.user, checkoutDto);
  }

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Post('checkout')
  checkout(@Req() req: ActorRequest, @Body() checkoutDto: CheckoutDto) {
    return this.ordersService.checkout(req.user, checkoutDto);
  }

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get('me')
  listMyOrders(@Req() req: ActorRequest) {
    return this.ordersService.listMyOrders(req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Get('tenant')
  listTenantOrders(@Req() req: ActorRequest, @Query() query: ListTenantOrdersDto) {
    return this.ordersService.listTenantOrders(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Patch(':id/fulfillment-status')
  updateFulfillmentStatus(
    @Req() req: ActorRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateFulfillmentStatusDto: UpdateFulfillmentStatusDto,
  ) {
    return this.ordersService.updateFulfillmentStatus(id, updateFulfillmentStatusDto, req.user);
  }

  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.CATALOG_MANAGER,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get(':id')
  findOrder(@Req() req: ActorRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.findOrder(id, req.user);
  }
}
