import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import { ProductReview } from '../catalog/entities/product-review.entity';
import { Product } from '../catalog/entities/product.entity';
import { Coupon } from '../coupons/coupon.entity';
import { OrderItem } from '../orders/order-item.entity';
import { Order, OrderLifecycleStatus, OrderStatus } from '../orders/order.entity';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductReview)
    private readonly productReviewsRepository: Repository<ProductReview>,
    @InjectRepository(Coupon)
    private readonly couponsRepository: Repository<Coupon>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async getOverview(actor: Actor, requestedTenantId: string | undefined, rangeDays: number) {
    const tenantId = this.resolveTenantScope(actor, requestedTenantId);
    const normalizedRangeDays = Math.min(Math.max(rangeDays, 1), 365);
    const since = new Date(Date.now() - normalizedRangeDays * 24 * 60 * 60 * 1000);

    const orders = await this.ordersRepository.find({
      where: {
        tenantId,
        createdAt: Between(since, new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    const paidOrders = orders.filter((order) => order.status === OrderStatus.PAID);
    const totalRevenue = paidOrders.reduce((sum, order) => sum + Number(order.total), 0);
    const totalOrders = orders.length;
    const checkoutConversionRate = totalOrders > 0 ? (paidOrders.length / totalOrders) * 100 : 0;
    const averageOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;
    const discountedOrders = orders.filter((order) => Number(order.discountTotal) > 0).length;
    const discountCaptureRate = totalOrders > 0 ? (discountedOrders / totalOrders) * 100 : 0;

    const salesByDayRows = await this.ordersRepository
      .createQueryBuilder('order')
      .select(`TO_CHAR(DATE_TRUNC('day', order.createdAt), 'YYYY-MM-DD')`, 'day')
      .addSelect('COUNT(order.id)', 'ordersCount')
      .addSelect('COALESCE(SUM(order.total), 0)', 'revenue')
      .where('order.tenantId = :tenantId', { tenantId })
      .andWhere('order.createdAt >= :since', { since: since.toISOString() })
      .andWhere('order.status = :status', { status: OrderStatus.PAID })
      .groupBy(`DATE_TRUNC('day', order.createdAt)`)
      .orderBy(`DATE_TRUNC('day', order.createdAt)`, 'ASC')
      .getRawMany<{ day: string; ordersCount: string; revenue: string }>();

    const topProducts = await this.orderItemsRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'order', 'order.id = item.orderId')
      .select('item.productId', 'productId')
      .addSelect('item.productName', 'productName')
      .addSelect('COUNT(DISTINCT order.id)', 'ordersCount')
      .addSelect('SUM(item.quantity)', 'unitsSold')
      .addSelect('COALESCE(SUM(item.lineTotal), 0)', 'revenue')
      .where('order.tenantId = :tenantId', { tenantId })
      .andWhere('order.createdAt >= :since', { since: since.toISOString() })
      .andWhere('order.status = :status', { status: OrderStatus.PAID })
      .groupBy('item.productId')
      .addGroupBy('item.productName')
      .orderBy('SUM(item.quantity)', 'DESC')
      .limit(8)
      .getRawMany<{ productId: string; productName: string; ordersCount: string; unitsSold: string; revenue: string }>();

    const lifecycleBreakdown = Object.values(OrderLifecycleStatus).map((status) => ({
      status,
      count: orders.filter((order) => order.lifecycleStatus === status).length,
    }));

    const distinctCustomerIds = [...new Set(paidOrders.map((order) => order.userId))];
    const recentCustomers = distinctCustomerIds.length
      ? await this.usersRepository.findBy({ id: In(distinctCustomerIds) })
      : [];

    return {
      rangeDays: normalizedRangeDays,
      revenue: this.toMoney(totalRevenue),
      totalOrders,
      paidOrders: paidOrders.length,
      averageOrderValue: this.toMoney(averageOrderValue),
      checkoutConversionRate: Number(checkoutConversionRate.toFixed(1)),
      discountCaptureRate: Number(discountCaptureRate.toFixed(1)),
      activeCustomers: distinctCustomerIds.length,
      recentCustomers: recentCustomers.slice(0, 5).map((customer) => ({
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
      })),
      salesByDay: salesByDayRows.map((row) => ({
        day: row.day,
        ordersCount: Number(row.ordersCount),
        revenue: row.revenue,
      })),
      topProducts: topProducts.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        ordersCount: Number(row.ordersCount),
        unitsSold: Number(row.unitsSold),
        revenue: row.revenue,
      })),
      lifecycleBreakdown,
    };
  }

  async exportOrdersCsv(actor: Actor, requestedTenantId: string | undefined): Promise<string> {
    const tenantId = this.resolveTenantScope(actor, requestedTenantId);
    const orders = await this.ordersRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    const rows = [
      ['orderId', 'status', 'lifecycleStatus', 'paymentStatus', 'fulfillmentType', 'couponCode', 'subtotal', 'discountTotal', 'shippingFee', 'total', 'currency', 'createdAt'],
      ...orders.map((order) => [
        order.id,
        order.status,
        order.lifecycleStatus,
        order.paymentStatus,
        order.fulfillmentType,
        order.couponCode ?? '',
        order.subtotal,
        order.discountTotal,
        order.shippingFee,
        order.total,
        order.currency,
        order.createdAt.toISOString(),
      ]),
    ];

    return this.toCsv(rows);
  }

  async exportProductsCsv(actor: Actor, requestedTenantId: string | undefined): Promise<string> {
    const tenantId = this.resolveTenantScope(actor, requestedTenantId);
    const products = await this.productsRepository.find({
      where: { tenantId },
      relations: { variants: true },
      order: { createdAt: 'DESC' },
    });
    const productIds = products.map((product) => product.id);
    const reviewSummaries = productIds.length
      ? await this.productReviewsRepository
          .createQueryBuilder('review')
          .select('review.productId', 'productId')
          .addSelect('AVG(review.rating)', 'averageRating')
          .addSelect('COUNT(review.id)', 'reviewCount')
          .where('review.productId IN (:...productIds)', { productIds })
          .groupBy('review.productId')
          .getRawMany<{ productId: string; averageRating: string; reviewCount: string }>()
      : [];
    const reviewsByProductId = new Map(reviewSummaries.map((row) => [row.productId, row]));

    const rows = [
      ['productId', 'name', 'sku', 'price', 'stock', 'reservedStock', 'variantsCount', 'averageRating', 'reviewCount', 'isActive', 'createdAt'],
      ...products.map((product) => {
        const reviewSummary = reviewsByProductId.get(product.id);
        return [
          product.id,
          product.name,
          product.sku ?? '',
          product.price,
          String(product.stock),
          String(product.reservedStock),
          String(product.variants.length),
          reviewSummary ? Number(Number(reviewSummary.averageRating).toFixed(1)).toString() : '0',
          reviewSummary?.reviewCount ?? '0',
          product.isActive ? 'true' : 'false',
          product.createdAt.toISOString(),
        ];
      }),
    ];

    return this.toCsv(rows);
  }

  private resolveTenantScope(actor: Actor, requestedTenantId?: string): string {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      if (!requestedTenantId) {
        throw new BadRequestException('tenantId es obligatorio para analytics de plataforma');
      }
      return requestedTenantId;
    }

    if (!actor.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }

    return actor.tenantId;
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }

  private toCsv(rows: string[][]): string {
    return rows
      .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }
}
