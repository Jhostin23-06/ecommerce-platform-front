import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartItem } from './cart-item.entity';
import { Cart, CartStatus } from './cart.entity';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
};

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartsRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemsRepository: Repository<CartItem>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly productVariantsRepository: Repository<ProductVariant>,
  ) {}

  async getMyCart(actor: Actor, tenantId?: string): Promise<Cart> {
    const targetTenantId = this.resolveTargetTenantId(actor, tenantId);
    return this.getOrCreateActiveCart(actor, targetTenantId);
  }

  async addItem(actor: Actor, addCartItemDto: AddCartItemDto): Promise<Cart> {
    const product = await this.productsRepository.findOne({
      where: { id: addCartItemDto.productId },
      relations: { variants: true },
    });
    if (!product || !product.isActive) {
      throw new NotFoundException('Producto no encontrado');
    }

    const targetTenantId = this.resolveTargetTenantId(actor, addCartItemDto.tenantId ?? product.tenantId);
    if (product.tenantId !== targetTenantId) {
      throw new NotFoundException('Producto no encontrado');
    }

    const activeVariants = (product.variants ?? []).filter((variant) => variant.isActive);
    const selectedVariant = await this.resolveSelectedVariant(product, activeVariants, addCartItemDto.productVariantId);
    const availableStock = this.resolveAvailableStock(product, selectedVariant);

    const cart = await this.getOrCreateActiveCart(actor, targetTenantId);
    const existingItem = cart.items.find(
      (item) => item.productId === product.id && (item.productVariantId ?? null) === (selectedVariant?.id ?? null),
    );
    const targetQuantity = (existingItem?.quantity ?? 0) + addCartItemDto.quantity;
    if (targetQuantity > availableStock) {
      throw new ConflictException(`Stock insuficiente para el producto: ${selectedVariant?.name ?? product.name}`);
    }

    const productNameSnapshot = selectedVariant ? `${product.name} - ${selectedVariant.name}` : product.name;
    const unitPrice = this.toMoney(selectedVariant ? selectedVariant.price : product.price);
    const skuSnapshot = selectedVariant?.sku ?? product.sku;
    const productImageUrlSnapshot = product.images?.[0]?.url ?? null;

    if (existingItem) {
      existingItem.quantity = targetQuantity;
      existingItem.unitPrice = unitPrice;
      existingItem.productNameSnapshot = productNameSnapshot;
      existingItem.skuSnapshot = skuSnapshot;
      existingItem.productImageUrlSnapshot = productImageUrlSnapshot;
      existingItem.lineTotal = this.toMoney(existingItem.quantity * Number(existingItem.unitPrice));
      await this.cartItemsRepository.save(existingItem);
    } else {
      const item = this.cartItemsRepository.create({
        cartId: cart.id,
        productId: product.id,
        productVariantId: selectedVariant?.id ?? null,
        productNameSnapshot,
        skuSnapshot,
        productImageUrlSnapshot,
        unitPrice,
        quantity: addCartItemDto.quantity,
        lineTotal: this.toMoney(addCartItemDto.quantity * Number(unitPrice)),
      });
      await this.cartItemsRepository.save(item);
    }

    return this.recalculateCart(cart.id);
  }

  async updateItem(
    actor: Actor,
    itemId: string,
    updateCartItemDto: UpdateCartItemDto,
    tenantId?: string,
  ): Promise<Cart> {
    const targetTenantId = this.resolveTargetTenantId(actor, tenantId);
    const cart = await this.getOrCreateActiveCart(actor, targetTenantId);
    const item = cart.items.find((cartItem) => cartItem.id === itemId);
    if (!item) {
      throw new NotFoundException('Item del carrito no encontrado');
    }

    await this.assertCartItemStock(item.productId, item.productVariantId, updateCartItemDto.quantity);

    item.quantity = updateCartItemDto.quantity;
    item.lineTotal = this.toMoney(item.quantity * Number(item.unitPrice));
    await this.cartItemsRepository.save(item);

    return this.recalculateCart(cart.id);
  }

  async removeItem(actor: Actor, itemId: string, tenantId?: string): Promise<Cart> {
    const targetTenantId = this.resolveTargetTenantId(actor, tenantId);
    const cart = await this.getOrCreateActiveCart(actor, targetTenantId);
    const item = cart.items.find((cartItem) => cartItem.id === itemId);
    if (!item) {
      throw new NotFoundException('Item del carrito no encontrado');
    }

    await this.cartItemsRepository.delete({ id: item.id });
    return this.recalculateCart(cart.id);
  }

  async clearCart(actor: Actor, tenantId?: string): Promise<{ success: true }> {
    const targetTenantId = this.resolveTargetTenantId(actor, tenantId);
    const cart = await this.getOrCreateActiveCart(actor, targetTenantId);
    await this.cartItemsRepository.delete({ cartId: cart.id });
    await this.cartsRepository.update(
      { id: cart.id },
      {
        subtotal: this.toMoney(0),
        discountTotal: this.toMoney(0),
        total: this.toMoney(0),
      },
    );

    return { success: true };
  }

  async markCartAsOrdered(cartId: string): Promise<void> {
    await this.cartsRepository.update({ id: cartId }, { status: CartStatus.ORDERED });
  }

  private async getOrCreateActiveCart(actor: Actor, tenantId: string): Promise<Cart> {
    const existing = await this.cartsRepository.findOne({
      where: {
        tenantId,
        userId: actor.userId,
        status: CartStatus.ACTIVE,
      },
      relations: { items: true },
    });

    if (existing) {
      if (existing.currency !== 'PEN') {
        existing.currency = 'PEN';
        await this.cartsRepository.save(existing);
      }
      return existing;
    }

    const cart = this.cartsRepository.create({
      tenantId,
      userId: actor.userId,
      status: CartStatus.ACTIVE,
      subtotal: this.toMoney(0),
      discountTotal: this.toMoney(0),
      total: this.toMoney(0),
      currency: 'PEN',
      items: [],
    });

    return this.cartsRepository.save(cart);
  }

  async recalculateCart(cartId: string): Promise<Cart> {
    const cart = await this.cartsRepository.findOne({
      where: { id: cartId },
      relations: { items: true },
    });
    if (!cart) {
      throw new NotFoundException('Carrito no encontrado');
    }

    const subtotal = cart.items.reduce((acc, item) => acc + Number(item.lineTotal), 0);
    const discountTotal = 0;
    const total = subtotal - discountTotal;

    cart.subtotal = this.toMoney(subtotal);
    cart.discountTotal = this.toMoney(discountTotal);
    cart.total = this.toMoney(total);

    await this.cartsRepository.save(cart);
    return cart;
  }

  private resolveTargetTenantId(actor: Actor, requestedTenantId?: string): string {
    if (requestedTenantId) {
      if (actor.role === UserRole.PLATFORM_SUPERADMIN || actor.role === UserRole.CUSTOMER) {
        return requestedTenantId;
      }

      if (!actor.tenantId || actor.tenantId !== requestedTenantId) {
        throw new NotFoundException('Tenant no encontrado');
      }

      return requestedTenantId;
    }

    if (actor.tenantId) {
      return actor.tenantId;
    }

    throw new BadRequestException('tenantId es obligatorio');
  }

  private async resolveSelectedVariant(
    product: Product,
    activeVariants: ProductVariant[],
    productVariantId?: string,
  ): Promise<ProductVariant | null> {
    if (!activeVariants.length) {
      if (productVariantId) {
        throw new NotFoundException('Variante no encontrada');
      }
      return null;
    }

    if (!productVariantId) {
      throw new ConflictException('Selecciona una variante del producto');
    }

    const selectedVariant = activeVariants.find((variant) => variant.id === productVariantId);
    if (!selectedVariant) {
      throw new NotFoundException('Variante no encontrada');
    }

    return selectedVariant;
  }

  private async assertCartItemStock(productId: string, productVariantId: string | null, quantity: number): Promise<void> {
    const product = await this.productsRepository.findOne({ where: { id: productId } });
    if (!product || !product.isActive) {
      throw new NotFoundException('Producto no encontrado');
    }

    let selectedVariant: ProductVariant | null = null;
    if (productVariantId) {
      selectedVariant = await this.productVariantsRepository.findOne({
        where: { id: productVariantId, productId },
      });
      if (!selectedVariant || !selectedVariant.isActive) {
        throw new NotFoundException('Variante no encontrada');
      }
    }

    const availableStock = this.resolveAvailableStock(product, selectedVariant);
    if (quantity > availableStock) {
      throw new ConflictException(`Stock insuficiente para el producto: ${selectedVariant?.name ?? product.name}`);
    }
  }

  private resolveAvailableStock(product: Product, variant: ProductVariant | null): number {
    if (variant) {
      return variant.stock - Math.max(variant.reservedStock ?? 0, 0);
    }
    return product.stock - Math.max(product.reservedStock ?? 0, 0);
  }

  private toMoney(value: number | string): string {
    return Number(value).toFixed(2);
  }
}
