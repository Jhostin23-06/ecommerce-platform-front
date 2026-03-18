import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Order, OrderStatus } from '../orders/order.entity';
import { Tenant } from '../tenants/tenant.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductReviewDto } from './dto/create-product-review.dto';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { ListCategoriesDto } from './dto/list-categories.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateProductDto, UpdateProductVariantDto } from './dto/update-product.dto';
import { Category } from './entities/category.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductReview } from './entities/product-review.entity';
import { ProductVariant, ProductVariantOption } from './entities/product-variant.entity';
import { Product } from './entities/product.entity';
import { WishlistItem } from './entities/wishlist-item.entity';

type Actor = { role: UserRole; tenantId: string | null };
type AuthenticatedActor = Actor & { userId: string };
type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ReviewSummary = {
  averageRating: number;
  reviewCount: number;
};

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly productImagesRepository: Repository<ProductImage>,
    @InjectRepository(ProductVariant)
    private readonly productVariantsRepository: Repository<ProductVariant>,
    @InjectRepository(ProductReview)
    private readonly productReviewsRepository: Repository<ProductReview>,
    @InjectRepository(WishlistItem)
    private readonly wishlistItemsRepository: Repository<WishlistItem>,
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
  ) {}

  async createCategory(createCategoryDto: CreateCategoryDto, actor: Actor): Promise<Category> {
    this.assertTenantAccess(createCategoryDto.tenantId, actor);
    await this.ensureTenantExists(createCategoryDto.tenantId);

    const existing = await this.categoriesRepository.findOne({
      where: {
        tenantId: createCategoryDto.tenantId,
        slug: createCategoryDto.slug.trim(),
      },
    });

    if (existing) {
      throw new ConflictException('El slug de categoria ya existe para este tenant');
    }

    const category = this.categoriesRepository.create({
      tenantId: createCategoryDto.tenantId,
      name: createCategoryDto.name.trim(),
      slug: createCategoryDto.slug.trim(),
      description: createCategoryDto.description?.trim() || null,
      isActive: createCategoryDto.isActive ?? true,
    });

    return this.categoriesRepository.save(category);
  }

  async listCategories(query: ListCategoriesDto): Promise<Category[]> {
    return this.categoriesRepository.find({
      where: {
        tenantId: query.tenantId,
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findCategory(categoryId: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException('Categoria no encontrada');
    }

    return category;
  }

  async updateCategory(categoryId: string, updateCategoryDto: UpdateCategoryDto, actor: Actor): Promise<Category> {
    const category = await this.findCategory(categoryId);
    this.assertTenantAccess(category.tenantId, actor);

    if (updateCategoryDto.slug && updateCategoryDto.slug.trim() !== category.slug) {
      const existing = await this.categoriesRepository.findOne({
        where: {
          tenantId: category.tenantId,
          slug: updateCategoryDto.slug.trim(),
        },
      });
      if (existing && existing.id !== category.id) {
        throw new ConflictException('El slug de categoria ya existe para este tenant');
      }
    }

    if (updateCategoryDto.name !== undefined) {
      category.name = updateCategoryDto.name.trim();
    }
    if (updateCategoryDto.slug !== undefined) {
      category.slug = updateCategoryDto.slug.trim();
    }
    if (updateCategoryDto.description !== undefined) {
      category.description = updateCategoryDto.description?.trim() || null;
    }
    if (updateCategoryDto.isActive !== undefined) {
      category.isActive = updateCategoryDto.isActive;
    }

    return this.categoriesRepository.save(category);
  }

  async deleteCategory(categoryId: string, actor: Actor): Promise<{ success: true }> {
    const category = await this.findCategory(categoryId);
    this.assertTenantAccess(category.tenantId, actor);

    const relatedProducts = await this.productsRepository.count({
      where: { tenantId: category.tenantId, categoryId: category.id },
    });
    if (relatedProducts > 0) {
      throw new ConflictException('No se puede eliminar una categoria con productos vinculados');
    }

    await this.categoriesRepository.delete({ id: category.id });
    return { success: true };
  }

  async createProduct(createProductDto: CreateProductDto, actor: Actor): Promise<Product> {
    this.assertTenantAccess(createProductDto.tenantId, actor);
    await this.ensureTenantExists(createProductDto.tenantId);

    const slug = createProductDto.slug.trim();
    await this.ensureProductSlugIsUnique(createProductDto.tenantId, slug);

    if (createProductDto.categoryId) {
      await this.ensureCategoryBelongsToTenant(createProductDto.categoryId, createProductDto.tenantId);
    }

    const product = await this.productsRepository.save(
      this.productsRepository.create({
        tenantId: createProductDto.tenantId,
        categoryId: createProductDto.categoryId ?? null,
        name: createProductDto.name.trim(),
        slug,
        description: createProductDto.description?.trim() || null,
        price: createProductDto.price.toFixed(2),
        stock: createProductDto.stock,
        reservedStock: 0,
        sku: createProductDto.sku?.trim() || null,
        isActive: createProductDto.isActive ?? true,
        images: this.normalizeImages(createProductDto.images ?? []),
      }),
    );

    if (createProductDto.variants?.length) {
      await this.replaceProductVariants(product, createProductDto.variants);
      await this.syncDerivedProductFields(product.id);
    }

    return this.findProduct(product.id);
  }

  async listProducts(query: ListProductsDto): Promise<PaginatedResult<Product>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const isActive = query.isActive ?? true;

    const qb = this.productsRepository
      .createQueryBuilder('product')
      .distinct(true)
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants', 'variants.isActive = true')
      .where('product.tenantId = :tenantId', { tenantId: query.tenantId })
      .andWhere('product.isActive = :isActive', { isActive });

    if (query.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', { categoryId: query.categoryId });
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(product.name) LIKE :search OR
          LOWER(product.slug) LIKE :search OR
          LOWER(COALESCE(product.description, '')) LIKE :search OR
          LOWER(COALESCE(product.sku, '')) LIKE :search OR
          LOWER(COALESCE(variants.name, '')) LIKE :search OR
          LOWER(COALESCE(variants.sku, '')) LIKE :search OR
          LOWER(CAST(COALESCE(variants.options, '[]'::jsonb) AS text)) LIKE :search
        )`,
        { search },
      );
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('product.price >= :minPrice', { minPrice: query.minPrice.toFixed(2) });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('product.price <= :maxPrice', { maxPrice: query.maxPrice.toFixed(2) });
    }
    if (query.inStock !== undefined) {
      qb.andWhere(
        query.inStock
          ? '(product.stock - COALESCE(product.reservedStock, 0)) > 0'
          : '(product.stock - COALESCE(product.reservedStock, 0)) <= 0',
      );
    }

    const sortBy = query.sortBy ?? 'newest';
    if (sortBy === 'oldest') {
      qb.orderBy('product.createdAt', 'ASC');
    } else if (sortBy === 'price_asc') {
      qb.orderBy('product.price', 'ASC');
    } else if (sortBy === 'price_desc') {
      qb.orderBy('product.price', 'DESC');
    } else if (sortBy === 'name_asc') {
      qb.orderBy('product.name', 'ASC');
    } else {
      qb.orderBy('product.createdAt', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, total] = await qb.getManyAndCount();
    await this.enrichProducts(items);

    if (sortBy === 'rating_desc') {
      items.sort((left, right) => {
        const ratingDiff = (right.averageRating ?? 0) - (left.averageRating ?? 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        return (right.reviewCount ?? 0) - (left.reviewCount ?? 0);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findProduct(productId: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id: productId },
      relations: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    await this.enrichProducts([product]);
    return product;
  }

  async findProductBySlug(tenantId: string, slug: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: {
        tenantId,
        slug: slug.trim(),
        isActive: true,
      },
      relations: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    await this.enrichProducts([product]);
    return product;
  }

  async updateProduct(productId: string, updateProductDto: UpdateProductDto, actor: Actor): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id: productId },
      relations: { variants: true },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    this.assertTenantAccess(product.tenantId, actor);

    if (updateProductDto.slug && updateProductDto.slug.trim() !== product.slug) {
      await this.ensureProductSlugIsUnique(product.tenantId, updateProductDto.slug.trim(), product.id);
    }

    if (updateProductDto.categoryId) {
      await this.ensureCategoryBelongsToTenant(updateProductDto.categoryId, product.tenantId);
    }

    if (updateProductDto.images) {
      await this.productImagesRepository.delete({ productId: product.id });
      product.images = updateProductDto.images.map((image) =>
        this.productImagesRepository.create({
          productId: product.id,
          url: image.url,
          altText: image.altText?.trim() || null,
          sortOrder: image.sortOrder ?? 0,
        }),
      );
    }

    if (updateProductDto.categoryId !== undefined) {
      product.categoryId = updateProductDto.categoryId ?? null;
    }
    if (updateProductDto.name !== undefined) {
      product.name = updateProductDto.name.trim();
    }
    if (updateProductDto.slug !== undefined) {
      product.slug = updateProductDto.slug.trim();
    }
    if (updateProductDto.description !== undefined) {
      product.description = updateProductDto.description?.trim() || null;
    }
    if (updateProductDto.sku !== undefined) {
      product.sku = updateProductDto.sku?.trim() || null;
    }
    if (updateProductDto.isActive !== undefined) {
      product.isActive = updateProductDto.isActive;
    }

    if (updateProductDto.variants !== undefined) {
      await this.replaceProductVariants(product, updateProductDto.variants);
      if (!updateProductDto.variants.length) {
        if (updateProductDto.price !== undefined) {
          product.price = updateProductDto.price.toFixed(2);
        }
        if (updateProductDto.stock !== undefined) {
          const reservedStock = Math.max(product.reservedStock ?? 0, 0);
          if (updateProductDto.stock < reservedStock) {
            throw new ConflictException(
              `El stock no puede ser menor que el stock reservado (${reservedStock}) para el producto ${product.name}`,
            );
          }
          product.stock = updateProductDto.stock;
        }
        await this.productsRepository.save(product);
        return this.findProduct(product.id);
      }
      await this.productsRepository.save(product);
      await this.syncDerivedProductFields(product.id);
      return this.findProduct(product.id);
    }

    const hasPersistedVariants = await this.productVariantsRepository.count({ where: { productId: product.id } });
    if (hasPersistedVariants > 0) {
      await this.productsRepository.save(product);
      await this.syncDerivedProductFields(product.id);
      return this.findProduct(product.id);
    }

    if (updateProductDto.price !== undefined) {
      product.price = updateProductDto.price.toFixed(2);
    }
    if (updateProductDto.stock !== undefined) {
      const reservedStock = Math.max(product.reservedStock ?? 0, 0);
      if (updateProductDto.stock < reservedStock) {
        throw new ConflictException(
          `El stock no puede ser menor que el stock reservado (${reservedStock}) para el producto ${product.name}`,
        );
      }
      product.stock = updateProductDto.stock;
    }

    await this.productsRepository.save(product);
    return this.findProduct(product.id);
  }

  async deleteProduct(productId: string, actor: Actor): Promise<{ success: true }> {
    const product = await this.productsRepository.findOne({
      where: { id: productId },
      relations: { variants: true },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    this.assertTenantAccess(product.tenantId, actor);

    const lockedVariant = product.variants.find((variant) => Math.max(variant.reservedStock ?? 0, 0) > 0);
    if (lockedVariant) {
      throw new ConflictException('No se puede eliminar un producto con variantes reservadas');
    }
    if (Math.max(product.reservedStock ?? 0, 0) > 0) {
      throw new ConflictException('No se puede eliminar un producto con stock reservado');
    }

    await this.productsRepository.delete({ id: product.id });
    return { success: true };
  }

  async listProductReviews(productId: string): Promise<{
    items: ProductReview[];
    averageRating: number;
    reviewCount: number;
  }> {
    await this.ensureProductExists(productId);

    const reviews = await this.productReviewsRepository
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.user', 'user')
      .where('review.productId = :productId', { productId })
      .orderBy('review.createdAt', 'DESC')
      .getMany();

    for (const review of reviews) {
      review.authorName = review.user?.fullName ?? 'Cliente';
    }

    const summary = await this.loadReviewSummaries([productId]);
    const metrics = summary.get(productId) ?? { averageRating: 0, reviewCount: 0 };

    return {
      items: reviews,
      averageRating: metrics.averageRating,
      reviewCount: metrics.reviewCount,
    };
  }

  async createOrUpdateProductReview(
    productId: string,
    dto: CreateProductReviewDto,
    actor: AuthenticatedActor,
  ): Promise<ProductReview> {
    const product = await this.ensureProductExists(productId);
    await this.ensureUserExists(actor.userId);

    let review = await this.productReviewsRepository.findOne({
      where: { productId, userId: actor.userId },
      relations: { user: true },
    });

    const isVerifiedPurchase = await this.hasPurchasedProduct(actor.userId, product.id);
    if (!review) {
      review = this.productReviewsRepository.create({
        tenantId: product.tenantId,
        productId: product.id,
        userId: actor.userId,
      });
    }

    review.rating = dto.rating;
    review.title = dto.title?.trim() || null;
    review.comment = dto.comment?.trim() || null;
    review.isVerifiedPurchase = isVerifiedPurchase;

    const saved = await this.productReviewsRepository.save(review);
    const hydrated = await this.productReviewsRepository.findOne({
      where: { id: saved.id },
      relations: { user: true },
    });

    if (!hydrated) {
      throw new NotFoundException('Review no encontrada');
    }
    hydrated.authorName = hydrated.user?.fullName ?? 'Cliente';
    return hydrated;
  }

  async listWishlist(actor: AuthenticatedActor, tenantId?: string): Promise<{ items: Product[]; productIds: string[] }> {
    const qb = this.wishlistItemsRepository
      .createQueryBuilder('wishlist')
      .leftJoinAndSelect('wishlist.product', 'product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants', 'variants.isActive = true')
      .where('wishlist.userId = :userId', { userId: actor.userId });

    if (tenantId) {
      qb.andWhere('wishlist.tenantId = :tenantId', { tenantId });
    }

    const wishlistItems = await qb.orderBy('wishlist.createdAt', 'DESC').getMany();
    const products = wishlistItems
      .map((entry) => entry.product)
      .filter((entry): entry is Product => Boolean(entry && entry.isActive));

    await this.enrichProducts(products);

    return {
      items: products,
      productIds: products.map((product) => product.id),
    };
  }

  async addWishlistItem(productId: string, tenantId: string, actor: AuthenticatedActor): Promise<{ success: true; inWishlist: true }> {
    const product = await this.ensureProductForTenant(productId, tenantId);
    const existing = await this.wishlistItemsRepository.findOne({
      where: {
        tenantId,
        userId: actor.userId,
        productId: product.id,
      },
    });

    if (!existing) {
      await this.wishlistItemsRepository.save(
        this.wishlistItemsRepository.create({
          tenantId,
          userId: actor.userId,
          productId: product.id,
        }),
      );
    }

    return { success: true, inWishlist: true };
  }

  async removeWishlistItem(
    productId: string,
    tenantId: string,
    actor: AuthenticatedActor,
  ): Promise<{ success: true; inWishlist: false }> {
    await this.wishlistItemsRepository.delete({
      tenantId,
      userId: actor.userId,
      productId,
    });

    return { success: true, inWishlist: false };
  }

  private async ensureTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.tenantsRepository.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }

  private async ensureCategoryBelongsToTenant(categoryId: string, tenantId: string): Promise<void> {
    const category = await this.categoriesRepository.findOne({
      where: {
        id: categoryId,
        tenantId,
      },
    });
    if (!category) {
      throw new NotFoundException('Categoria no encontrada para este tenant');
    }
  }

  private async ensureProductExists(productId: string): Promise<Product> {
    const product = await this.productsRepository.findOne({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    return product;
  }

  private async ensureProductForTenant(productId: string, tenantId: string): Promise<Product> {
    const product = await this.productsRepository.findOne({
      where: { id: productId, tenantId, isActive: true },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    return product;
  }

  private async ensureProductSlugIsUnique(tenantId: string, slug: string, excludedProductId?: string): Promise<void> {
    const existing = await this.productsRepository.findOne({
      where: {
        tenantId,
        slug,
      },
    });

    if (existing && existing.id !== excludedProductId) {
      throw new ConflictException('El slug de producto ya existe para este tenant');
    }
  }

  private normalizeImages(images: Array<{ url: string; altText?: string; sortOrder?: number }>): ProductImage[] {
    return images.map((image) =>
      this.productImagesRepository.create({
        url: image.url,
        altText: image.altText?.trim() || null,
        sortOrder: image.sortOrder ?? 0,
      }),
    );
  }

  private async replaceProductVariants(
    product: Product,
    variants: Array<CreateProductVariantDto | UpdateProductVariantDto>,
  ): Promise<void> {
    const existingVariants = await this.productVariantsRepository.find({
      where: { productId: product.id },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const existingById = new Map(existingVariants.map((variant) => [variant.id, variant]));
    const incomingIds = new Set(variants.map((variant) => ('id' in variant ? variant.id : undefined)).filter(Boolean) as string[]);

    for (const existingVariant of existingVariants) {
      if (!incomingIds.has(existingVariant.id) && Math.max(existingVariant.reservedStock ?? 0, 0) > 0) {
        throw new ConflictException(`No se puede eliminar la variante ${existingVariant.name} porque tiene stock reservado`);
      }
    }

    const normalizedSlugs = new Set<string>();
    const payload = variants.map((variant, index) => {
      const slug = (variant.slug?.trim() || this.slugifyVariantName(variant.name)).toLowerCase();
      if (normalizedSlugs.has(slug)) {
        throw new ConflictException(`El slug de variante ${slug} esta duplicado para el producto ${product.name}`);
      }
      normalizedSlugs.add(slug);

      const existing = 'id' in variant && variant.id ? existingById.get(variant.id) : undefined;
      if ('id' in variant && variant.id && !existing) {
        throw new NotFoundException('Variante no encontrada para este producto');
      }

      const reservedStock = Math.max(existing?.reservedStock ?? 0, 0);
      if (variant.stock < reservedStock) {
        throw new ConflictException(
          `El stock de la variante ${variant.name} no puede ser menor que el reservado (${reservedStock})`,
        );
      }

      return this.productVariantsRepository.create({
        id: existing?.id,
        productId: product.id,
        name: variant.name.trim(),
        slug,
        sku: variant.sku?.trim() || null,
        price: variant.price.toFixed(2),
        stock: variant.stock,
        reservedStock,
        isActive: variant.isActive ?? true,
        sortOrder: variant.sortOrder ?? index,
        options: variant.options.map((option) => ({
          name: option.name.trim(),
          value: option.value.trim(),
        })),
      });
    });

    const removableIds = existingVariants.filter((variant) => !incomingIds.has(variant.id)).map((variant) => variant.id);
    if (removableIds.length) {
      await this.productVariantsRepository.delete(removableIds);
    }
    if (payload.length) {
      await this.productVariantsRepository.save(payload);
    }
  }

  private async syncDerivedProductFields(productId: string): Promise<void> {
    const product = await this.productsRepository.findOne({ where: { id: productId } });
    if (!product) {
      return;
    }

    const variants = await this.productVariantsRepository.find({
      where: { productId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    const activeVariants = variants.filter((variant) => variant.isActive);
    if (!activeVariants.length) {
      product.price = '0.00';
      product.stock = 0;
      product.reservedStock = 0;
      await this.productsRepository.save(product);
      return;
    }

    const minPrice = activeVariants.reduce((lowest, variant) => Math.min(lowest, Number(variant.price)), Number(activeVariants[0].price));
    const totalStock = activeVariants.reduce((sum, variant) => sum + variant.stock, 0);
    const totalReservedStock = activeVariants.reduce((sum, variant) => sum + Math.max(variant.reservedStock ?? 0, 0), 0);

    product.price = minPrice.toFixed(2);
    product.stock = totalStock;
    product.reservedStock = totalReservedStock;
    await this.productsRepository.save(product);
  }

  private async enrichProducts(products: Product[]): Promise<void> {
    if (!products.length) {
      return;
    }

    const productIds = products.map((product) => product.id);
    const reviewSummaries = await this.loadReviewSummaries(productIds);

    for (const product of products) {
      const variants = (product.variants ?? [])
        .filter((variant) => variant.isActive)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
      product.variants = variants;
      product.hasVariants = variants.length > 0;
      product.priceFrom = variants.length ? Number(variants[0].price).toFixed(2) : Number(product.price).toFixed(2);
      product.priceTo = variants.length
        ? Math.max(...variants.map((variant) => Number(variant.price))).toFixed(2)
        : Number(product.price).toFixed(2);
      const summary = reviewSummaries.get(product.id) ?? { averageRating: 0, reviewCount: 0 };
      product.averageRating = summary.averageRating;
      product.reviewCount = summary.reviewCount;
    }
  }

  private async loadReviewSummaries(productIds: string[]): Promise<Map<string, ReviewSummary>> {
    if (!productIds.length) {
      return new Map();
    }

    const rows = await this.productReviewsRepository
      .createQueryBuilder('review')
      .select('review.productId', 'productId')
      .addSelect('AVG(review.rating)', 'averageRating')
      .addSelect('COUNT(review.id)', 'reviewCount')
      .where('review.productId IN (:...productIds)', { productIds })
      .groupBy('review.productId')
      .getRawMany<{ productId: string; averageRating: string; reviewCount: string }>();

    return new Map(
      rows.map((row) => [
        row.productId,
        {
          averageRating: Number(Number(row.averageRating).toFixed(1)),
          reviewCount: Number(row.reviewCount),
        },
      ]),
    );
  }

  private async hasPurchasedProduct(userId: string, productId: string): Promise<boolean> {
    const count = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'ord', 'ord.id = item.orderId')
      .where('item.productId = :productId', { productId })
      .andWhere('ord.userId = :userId', { userId })
      .andWhere('ord.status = :status', { status: OrderStatus.PAID })
      .getCount();

    return count > 0;
  }

  private slugifyVariantName(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 160);
  }

  private assertTenantAccess(targetTenantId: string, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }

    if (!actor.tenantId || actor.tenantId !== targetTenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }
}
