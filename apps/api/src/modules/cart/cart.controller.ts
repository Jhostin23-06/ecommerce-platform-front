import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartTenantQueryDto } from './dto/cart-tenant-query.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartService } from './cart.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get('me')
  getMyCart(@Req() req: ActorRequest, @Query() query: CartTenantQueryDto) {
    return this.cartService.getMyCart(req.user, query.tenantId);
  }

  @Post('items')
  addItem(@Req() req: ActorRequest, @Body() addCartItemDto: AddCartItemDto) {
    return this.cartService.addItem(req.user, addCartItemDto);
  }

  @Patch('items/:itemId')
  updateItem(
    @Req() req: ActorRequest,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Query() query: CartTenantQueryDto,
    @Body() updateCartItemDto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItem(req.user, itemId, updateCartItemDto, query.tenantId);
  }

  @Delete('items/:itemId')
  removeItem(
    @Req() req: ActorRequest,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Query() query: CartTenantQueryDto,
  ) {
    return this.cartService.removeItem(req.user, itemId, query.tenantId);
  }

  @Delete('clear')
  clearCart(@Req() req: ActorRequest, @Query() query: CartTenantQueryDto) {
    return this.cartService.clearCart(req.user, query.tenantId);
  }
}
