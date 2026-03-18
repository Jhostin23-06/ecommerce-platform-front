import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Order } from '../orders/order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { CatalogProductReviewsController } from './catalog-product-reviews.controller';
import { CatalogCategoriesController } from './catalog-categories.controller';
import { CatalogProductsController } from './catalog-products.controller';
import { CatalogService } from './catalog.service';
import { Category } from './entities/category.entity';
import { ProductImage } from './entities/product-image.entity';
import { Product } from './entities/product.entity';
import { ProductReview } from './entities/product-review.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { WishlistItem } from './entities/wishlist-item.entity';
import { UploadsController } from './upload/uploads.controller';
import { UploadsService } from './upload/uploads.service';
import { WishlistController } from './wishlist.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Product,
      ProductImage,
      ProductVariant,
      ProductReview,
      WishlistItem,
      Tenant,
      User,
      Order,
      OrderItem,
    ]),
  ],
  controllers: [
    CatalogCategoriesController,
    CatalogProductsController,
    CatalogProductReviewsController,
    WishlistController,
    UploadsController,
  ],
  providers: [CatalogService, UploadsService],
  exports: [CatalogService, UploadsService],
})
export class CatalogModule {}
