import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ToggleWishlistItemDto } from './dto/toggle-wishlist-item.dto';
import { CatalogService } from './catalog.service';

@UseGuards(JwtAuthGuard)
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  listWishlist(
    @Query('tenantId') tenantId: string | undefined,
    @Req() req: { user: { userId: string; role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.listWishlist(req.user, tenantId);
  }

  @Post('items/:productId')
  addWishlistItem(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: ToggleWishlistItemDto,
    @Req() req: { user: { userId: string; role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.addWishlistItem(productId, dto.tenantId, req.user);
  }

  @Delete('items/:productId')
  removeWishlistItem(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: ToggleWishlistItemDto,
    @Req() req: { user: { userId: string; role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.removeWishlistItem(productId, dto.tenantId, req.user);
  }
}
