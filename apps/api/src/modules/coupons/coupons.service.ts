import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { Category } from '../catalog/entities/category.entity';
import { Product } from '../catalog/entities/product.entity';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { Coupon, CouponRules, CouponScope, CouponType } from './coupon.entity';

type Actor = {
  role: UserRole;
  tenantId: string | null;
};

type CouponEvaluationItem = {
  productId: string;
  quantity: number;
};

type CouponRuleReference = {
  id: string;
  label: string;
};

export type CouponEvaluationFeedback = {
  scope: CouponScope;
  title: string;
  message: string;
  matchedQuantity?: number;
  requiredQuantity?: number;
  missingQuantity?: number;
  targetProducts?: CouponRuleReference[];
  targetCategories?: CouponRuleReference[];
  requiredProducts?: CouponRuleReference[];
  requiredCategories?: CouponRuleReference[];
  matchedProducts?: CouponRuleReference[];
  matchedCategories?: CouponRuleReference[];
  missingProducts?: CouponRuleReference[];
  missingCategories?: CouponRuleReference[];
};

export type CouponEvaluationResult = {
  coupon: Coupon;
  eligible: boolean;
  discountAmount: number;
  feedback: CouponEvaluationFeedback;
};

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon)
    private readonly couponsRepository: Repository<Coupon>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async create(createCouponDto: CreateCouponDto, actor: Actor): Promise<Coupon> {
    this.assertTenantAccess(createCouponDto.tenantId, actor);

    const code = createCouponDto.code.trim().toUpperCase();
    const existing = await this.couponsRepository.findOne({
      where: { tenantId: createCouponDto.tenantId, code },
    });
    if (existing) {
      throw new ConflictException('El codigo de cupon ya existe para este tenant');
    }

    const rules = await this.normalizeAndValidateRules(createCouponDto.tenantId, createCouponDto.scope, createCouponDto.rules);
    const coupon = this.couponsRepository.create({
      tenantId: createCouponDto.tenantId,
      code,
      type: createCouponDto.type,
      scope: createCouponDto.scope ?? CouponScope.ORDER,
      value: this.toMoney(createCouponDto.value),
      maxUsage: createCouponDto.maxUsage ?? null,
      isActive: createCouponDto.isActive ?? true,
      startsAt: createCouponDto.startsAt ? new Date(createCouponDto.startsAt) : null,
      endsAt: createCouponDto.endsAt ? new Date(createCouponDto.endsAt) : null,
      rules,
    });

    return this.couponsRepository.save(coupon);
  }

  async list(query: ListCouponsDto, actor: Actor): Promise<Coupon[]> {
    this.assertTenantAccess(query.tenantId, actor);

    const qb = this.couponsRepository
      .createQueryBuilder('coupon')
      .where('coupon.tenantId = :tenantId', { tenantId: query.tenantId })
      .orderBy('coupon.createdAt', 'DESC');

    if (query.code) {
      qb.andWhere('coupon.code LIKE :code', { code: `%${query.code.trim().toUpperCase()}%` });
    }

    return qb.getMany();
  }

  async update(couponId: string, updateCouponDto: UpdateCouponDto, actor: Actor): Promise<Coupon> {
    const coupon = await this.findOne(couponId);
    this.assertTenantAccess(coupon.tenantId, actor);

    if (updateCouponDto.code && updateCouponDto.code.trim().toUpperCase() !== coupon.code) {
      const newCode = updateCouponDto.code.trim().toUpperCase();
      const existing = await this.couponsRepository.findOne({
        where: { tenantId: coupon.tenantId, code: newCode },
      });
      if (existing && existing.id !== coupon.id) {
        throw new ConflictException('El codigo de cupon ya existe para este tenant');
      }
      coupon.code = newCode;
    }

    if (updateCouponDto.type !== undefined) {
      coupon.type = updateCouponDto.type;
    }
    if (updateCouponDto.scope !== undefined) {
      coupon.scope = updateCouponDto.scope;
    }
    if (updateCouponDto.value !== undefined) {
      coupon.value = this.toMoney(updateCouponDto.value);
    }
    if (updateCouponDto.maxUsage !== undefined) {
      coupon.maxUsage = updateCouponDto.maxUsage;
    }
    if (updateCouponDto.isActive !== undefined) {
      coupon.isActive = updateCouponDto.isActive;
    }
    if (updateCouponDto.startsAt !== undefined) {
      coupon.startsAt = updateCouponDto.startsAt ? new Date(updateCouponDto.startsAt) : null;
    }
    if (updateCouponDto.endsAt !== undefined) {
      coupon.endsAt = updateCouponDto.endsAt ? new Date(updateCouponDto.endsAt) : null;
    }
    if (updateCouponDto.rules !== undefined || updateCouponDto.scope !== undefined) {
      coupon.rules = await this.normalizeAndValidateRules(coupon.tenantId, coupon.scope, updateCouponDto.rules ?? coupon.rules);
    }

    return this.couponsRepository.save(coupon);
  }

  async delete(couponId: string, actor: Actor): Promise<{ success: true }> {
    const coupon = await this.findOne(couponId);
    this.assertTenantAccess(coupon.tenantId, actor);
    if (coupon.usageCount > 0) {
      throw new ConflictException('No se puede eliminar un cupon que ya tuvo usos. Desactivalo en su lugar.');
    }
    await this.couponsRepository.delete({ id: coupon.id });
    return { success: true };
  }

  async evaluateCoupon(
    tenantId: string,
    code: string,
    subtotal: number,
    items: CouponEvaluationItem[] = [],
  ): Promise<CouponEvaluationResult> {
    const evaluation = await this.inspectCoupon(tenantId, code, subtotal, items);
    if (!evaluation.eligible) {
      throw new ConflictException(evaluation.feedback.message);
    }

    return evaluation;
  }

  async inspectCoupon(
    tenantId: string,
    code: string,
    subtotal: number,
    items: CouponEvaluationItem[] = [],
  ): Promise<CouponEvaluationResult> {
    const coupon = await this.couponsRepository.findOne({
      where: {
        tenantId,
        code: code.trim().toUpperCase(),
      },
    });
    if (!coupon) {
      throw new NotFoundException('Cupon no encontrado');
    }

    if (!coupon.isActive) {
      throw new ConflictException('El cupon esta inactivo');
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new ConflictException('El cupon todavia no esta activo');
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new ConflictException('El cupon expiro');
    }
    if (coupon.maxUsage !== null && coupon.usageCount >= coupon.maxUsage) {
      throw new ConflictException('El cupon alcanzo su limite de uso');
    }

    const feedback = await this.inspectCouponRules(coupon, tenantId, items);
    let discountAmount = 0;
    if (feedback.eligible && coupon.type === CouponType.PERCENTAGE) {
      discountAmount = (subtotal * Number(coupon.value)) / 100;
    } else if (feedback.eligible) {
      discountAmount = Number(coupon.value);
    }

    if (discountAmount > subtotal) {
      discountAmount = subtotal;
    }

    return {
      coupon,
      eligible: feedback.eligible,
      discountAmount,
      feedback: feedback.feedback,
    };
  }

  async registerCouponUsage(couponId: string): Promise<void> {
    await this.couponsRepository.increment({ id: couponId }, 'usageCount', 1);
  }

  async findOne(couponId: string): Promise<Coupon> {
    const coupon = await this.couponsRepository.findOne({ where: { id: couponId } });
    if (!coupon) {
      throw new NotFoundException('Cupon no encontrado');
    }
    return coupon;
  }

  private async inspectCouponRules(
    coupon: Coupon,
    tenantId: string,
    items: CouponEvaluationItem[],
  ): Promise<{
    eligible: boolean;
    feedback: CouponEvaluationFeedback;
  }> {
    const rules = coupon.rules ?? {};

    if (coupon.scope === CouponScope.ORDER) {
      return {
        eligible: true,
        feedback: {
          scope: CouponScope.ORDER,
          title: 'Cupon aplicado',
          message: 'El cupon aplica a todo el pedido.',
        },
      };
    }

    if (!items.length) {
      return {
        eligible: false,
        feedback: {
          scope: coupon.scope,
          title: coupon.scope === CouponScope.VOLUME ? 'Descuento por volumen' : 'Descuento bundle',
          message:
            coupon.scope === CouponScope.VOLUME
              ? 'Agrega productos al carrito para cumplir la cantidad minima del descuento.'
              : 'Agrega los productos del bundle al carrito para habilitar el descuento.',
        },
      };
    }

    const products = await this.productsRepository.findByIds(items.map((item) => item.productId));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const targetProducts = await this.loadProductReferences(rules.productIds);
    const targetCategories = await this.loadCategoryReferences(rules.categoryIds);

    const tenantItems = items.filter((item) => {
      const product = productsById.get(item.productId);
      return Boolean(product && product.tenantId === tenantId);
    });

    const eligibleItems = tenantItems.filter((item) => {
      const product = productsById.get(item.productId);
      if (!product) {
        return false;
      }
      const productIdMatch = !rules.productIds?.length || rules.productIds.includes(product.id);
      const categoryIdMatch = !rules.categoryIds?.length || (product.categoryId ? rules.categoryIds.includes(product.categoryId) : false);
      return productIdMatch && categoryIdMatch;
    });

    if (coupon.scope === CouponScope.VOLUME) {
      const minQuantity = rules.minQuantity ?? 0;
      const totalQuantity = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
      const missingQuantity = Math.max(minQuantity - totalQuantity, 0);
      const eligible = Boolean(minQuantity) && totalQuantity >= minQuantity;

      return {
        eligible,
        feedback: {
          scope: CouponScope.VOLUME,
          title: eligible ? 'Descuento por volumen listo' : 'Te falta poco para el descuento por volumen',
          message: eligible
            ? `Cumples la regla de volumen con ${totalQuantity} unidades elegibles.`
            : `Agrega ${missingQuantity} unidad${missingQuantity === 1 ? '' : 'es'} mas para activar el descuento.`,
          matchedQuantity: totalQuantity,
          requiredQuantity: minQuantity || undefined,
          missingQuantity: missingQuantity || undefined,
          targetProducts,
          targetCategories,
        },
      };
    }

    const requiredProductIds = rules.requiredProductIds ?? rules.productIds ?? [];
    const requiredCategoryIds = rules.requiredCategoryIds ?? rules.categoryIds ?? [];
    if (!requiredProductIds.length && !requiredCategoryIds.length) {
      throw new ConflictException('El bundle no tiene reglas configuradas');
    }

    const requiredProducts = await this.loadProductReferences(requiredProductIds);
    const requiredCategories = await this.loadCategoryReferences(requiredCategoryIds);
    const presentProductIds = new Set(tenantItems.map((item) => item.productId));
    const presentCategoryIds = new Set(
      tenantItems
        .map((item) => productsById.get(item.productId)?.categoryId)
        .filter((entry): entry is string => Boolean(entry)),
    );

    const matchedProducts = requiredProducts?.filter((product) => presentProductIds.has(product.id));
    const missingProducts = requiredProducts?.filter((product) => !presentProductIds.has(product.id));
    const matchedCategories = requiredCategories?.filter((category) => presentCategoryIds.has(category.id));
    const missingCategories = requiredCategories?.filter((category) => !presentCategoryIds.has(category.id));
    const eligible = !missingProducts?.length && !missingCategories?.length;

    return {
      eligible,
      feedback: {
        scope: CouponScope.BUNDLE,
        title: eligible ? 'Bundle completo' : 'Bundle incompleto',
        message: eligible
          ? 'Tu carrito ya cumple la combinacion requerida para el descuento.'
          : 'Agrega los productos o categorias faltantes para completar el bundle.',
        targetProducts,
        targetCategories,
        requiredProducts,
        requiredCategories,
        matchedProducts,
        matchedCategories,
        missingProducts,
        missingCategories,
      },
    };
  }

  private async normalizeAndValidateRules(
    tenantId: string,
    scope: CouponScope | undefined,
    rules?: CouponRules | null,
  ): Promise<CouponRules | null> {
    const normalizedScope = scope ?? CouponScope.ORDER;
    if (!rules) {
      if (normalizedScope === CouponScope.ORDER) {
        return null;
      }
      return {};
    }

    const normalized: CouponRules = {
      minQuantity: rules.minQuantity ?? null,
      productIds: this.normalizeUuidList(rules.productIds),
      categoryIds: this.normalizeUuidList(rules.categoryIds),
      requiredProductIds: this.normalizeUuidList(rules.requiredProductIds),
      requiredCategoryIds: this.normalizeUuidList(rules.requiredCategoryIds),
    };

    if (normalized.productIds?.length) {
      await this.assertProductsBelongToTenant(tenantId, normalized.productIds);
    }
    if (normalized.requiredProductIds?.length) {
      await this.assertProductsBelongToTenant(tenantId, normalized.requiredProductIds);
    }
    if (normalized.categoryIds?.length) {
      await this.assertCategoriesBelongToTenant(tenantId, normalized.categoryIds);
    }
    if (normalized.requiredCategoryIds?.length) {
      await this.assertCategoriesBelongToTenant(tenantId, normalized.requiredCategoryIds);
    }

    if (normalizedScope === CouponScope.VOLUME && (!normalized.minQuantity || normalized.minQuantity < 2)) {
      throw new ConflictException('Los descuentos por volumen requieren minQuantity >= 2');
    }

    if (
      normalizedScope === CouponScope.BUNDLE &&
      !(normalized.requiredProductIds?.length || normalized.requiredCategoryIds?.length || normalized.productIds?.length || normalized.categoryIds?.length)
    ) {
      throw new ConflictException('Los descuentos bundle requieren productos o categorias objetivo');
    }

    return normalized;
  }

  private async loadProductReferences(productIds?: string[]): Promise<CouponRuleReference[] | undefined> {
    if (!productIds?.length) {
      return undefined;
    }

    const products = await this.productsRepository.findByIds(productIds);
    const productsById = new Map(products.map((product) => [product.id, product]));
    return productIds.map((id) => ({
      id,
      label: productsById.get(id)?.name ?? `Producto ${id.slice(0, 8)}`,
    }));
  }

  private async loadCategoryReferences(categoryIds?: string[]): Promise<CouponRuleReference[] | undefined> {
    if (!categoryIds?.length) {
      return undefined;
    }

    const categories = await this.categoriesRepository.findByIds(categoryIds);
    const categoriesById = new Map(categories.map((category) => [category.id, category]));
    return categoryIds.map((id) => ({
      id,
      label: categoriesById.get(id)?.name ?? `Categoria ${id.slice(0, 8)}`,
    }));
  }

  private async assertProductsBelongToTenant(tenantId: string, productIds: string[]): Promise<void> {
    const products = await this.productsRepository.findByIds(productIds);
    if (products.length !== productIds.length || products.some((product) => product.tenantId !== tenantId)) {
      throw new NotFoundException('Uno o mas productos del cupon no pertenecen al tenant');
    }
  }

  private async assertCategoriesBelongToTenant(tenantId: string, categoryIds: string[]): Promise<void> {
    const categories = await this.categoriesRepository.findByIds(categoryIds);
    if (categories.length !== categoryIds.length || categories.some((category) => category.tenantId !== tenantId)) {
      throw new NotFoundException('Una o mas categorias del cupon no pertenecen al tenant');
    }
  }

  private normalizeUuidList(values?: string[] | null): string[] | undefined {
    if (!values?.length) {
      return undefined;
    }
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private assertTenantAccess(targetTenantId: string, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }
    if (!actor.tenantId || actor.tenantId !== targetTenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }
}
