import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreateProductReviewDto } from './dto/create-product-review.dto';
import { CatalogService } from './catalog.service';

@Controller('catalog/products/:productId/reviews')
export class CatalogProductReviewsController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  listReviews(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.catalogService.listProductReviews(productId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  createOrUpdateReview(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: CreateProductReviewDto,
    @Req() req: { user: { userId: string; role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.createOrUpdateProductReview(productId, dto, req.user);
  }
}
