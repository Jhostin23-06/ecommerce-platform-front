import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import {
  BillingDocument,
  BillingDocumentKind,
  BillingDocumentStatus as BillingDocumentIssueStatus,
} from '../billing/entities/billing-document.entity';
import { BillingSettings } from '../billing/entities/billing-settings.entity';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/cart-item.entity';
import { Cart, CartStatus } from '../cart/cart.entity';
import { CouponEvaluationFeedback, CouponsService } from '../coupons/coupons.service';
import { DeliveryZonesService } from '../delivery-zones/delivery-zones.service';
import { PickupPointsService } from '../pickup-points/pickup-points.service';
import { JobsQueueService } from '../../queue/jobs-queue.service';
import { BillingDetailsDto, CheckoutDto, DeliveryAddressDto, PickupDetailsDto } from './dto/checkout.dto';
import { ListTenantOrdersDto } from './dto/list-tenant-orders.dto';
import { UpdateFulfillmentStatusDto } from './dto/update-fulfillment-status.dto';
import { OrderEmailService } from './order-email.service';
import { OrderItem } from './order-item.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import {
  BillingDetails,
  DeliveryAddress,
  FulfillmentStatus,
  FulfillmentType,
  Order,
  OrderLifecycleStatus,
  OrderStatus,
  PickupDetails,
} from './order.entity';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
};

type CheckoutComputation = {
  cart: Cart;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  couponCode: string | null;
  couponId: string | null;
  fulfillmentType: FulfillmentType;
  deliveryAddress: DeliveryAddress | null;
  pickupDetails: PickupDetails | null;
  billingDetails: BillingDetails | null;
  fulfillmentNotes: string | null;
  estimatedFulfillmentAt: Date | null;
  deliveryZoneId: string | null;
  deliveryZoneName: string | null;
  deliveryWindow: string | null;
  couponEvaluation: {
    code: string;
    eligible: boolean;
    discountAmount: string;
    feedback: CouponEvaluationFeedback;
  } | null;
};

type ComputeCheckoutOptions = {
  enforceFulfillmentDetails: boolean;
  strictCouponEligibility: boolean;
};

type LifecycleChangeSource = 'checkout' | 'payment' | 'fulfillment' | 'payment_failure' | 'worker';

@Injectable()
export class OrdersService {
  private readonly defaultDeliveryFee = 10;
  private readonly deliveryEtaHours = 24;
  private readonly pickupEtaHours = 4;
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(OrderStatusHistory)
    private readonly orderStatusHistoryRepository: Repository<OrderStatusHistory>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly productVariantsRepository: Repository<ProductVariant>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(BillingDocument)
    private readonly billingDocumentsRepository: Repository<BillingDocument>,
    @InjectRepository(BillingSettings)
    private readonly billingSettingsRepository: Repository<BillingSettings>,
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly couponsService: CouponsService,
    private readonly deliveryZonesService: DeliveryZonesService,
    private readonly pickupPointsService: PickupPointsService,
    private readonly orderEmailService: OrderEmailService,
    private readonly jobsQueueService: JobsQueueService,
  ) {}

  async previewCheckout(actor: Actor, checkoutDto: CheckoutDto): Promise<{
    subtotal: string;
    discountTotal: string;
    shippingFee: string;
    total: string;
    currency: string;
    couponCode: string | null;
    fulfillmentType: FulfillmentType;
    estimatedFulfillmentAt: string | null;
    deliveryZoneName: string | null;
    deliveryWindow: string | null;
    couponEvaluation: CheckoutComputation['couponEvaluation'];
  }> {
    const computed = await this.computeCheckout(actor, checkoutDto, {
      enforceFulfillmentDetails: false,
      strictCouponEligibility: false,
    });

    return {
      subtotal: this.toMoney(computed.subtotal),
      discountTotal: this.toMoney(computed.discountTotal),
      shippingFee: this.toMoney(computed.shippingFee),
      total: this.toMoney(computed.total),
      currency: computed.cart.currency,
      couponCode: computed.couponCode,
      fulfillmentType: computed.fulfillmentType,
      estimatedFulfillmentAt: computed.estimatedFulfillmentAt?.toISOString() ?? null,
      deliveryZoneName: computed.deliveryZoneName,
      deliveryWindow: computed.deliveryWindow,
      couponEvaluation: computed.couponEvaluation,
    };
  }

  async checkout(actor: Actor, checkoutDto: CheckoutDto): Promise<Order> {
    const {
      cart,
      subtotal,
      discountTotal,
      shippingFee,
      total,
      couponCode,
      couponId,
      fulfillmentType,
      deliveryAddress,
      pickupDetails,
      billingDetails,
      fulfillmentNotes,
      estimatedFulfillmentAt,
      deliveryZoneId,
      deliveryZoneName,
      deliveryWindow,
    } = await this.computeCheckout(actor, checkoutDto, {
      enforceFulfillmentDetails: true,
      strictCouponEligibility: true,
    });

    const savedOrder = await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalOrderItemsRepository = manager.getRepository(OrderItem);
      const transactionalProductsRepository = manager.getRepository(Product);
      const transactionalProductVariantsRepository = manager.getRepository(ProductVariant);
      const transactionalCartsRepository = manager.getRepository(Cart);
      const transactionalCartItemsRepository = manager.getRepository(CartItem);
      const transactionalOrderStatusHistoryRepository = manager.getRepository(OrderStatusHistory);

      const transactionalCart = await transactionalCartsRepository
        .createQueryBuilder('cart')
        .setLock('pessimistic_write')
        .where('cart.id = :cartId', { cartId: cart.id })
        .getOne();

      if (!transactionalCart || transactionalCart.status !== CartStatus.ACTIVE) {
        throw new ConflictException('El carrito no esta activo');
      }

      const lockedCartItems = await transactionalCartItemsRepository
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.cartId = :cartId', { cartId: cart.id })
        .getMany();

      if (!lockedCartItems.length) {
        throw new BadRequestException('El carrito esta vacio');
      }

      await this.reserveStockForOrderItems(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        lockedCartItems,
      );

      const order = transactionalOrdersRepository.create({
        tenantId: cart.tenantId,
        userId: actor.userId,
        status: OrderStatus.PENDING_PAYMENT,
        lifecycleStatus: OrderLifecycleStatus.PENDING,
        paymentStatus: 'unpaid',
        couponCode,
        fulfillmentType,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        deliveryAddress,
        pickupDetails,
        billingDetails,
        deliveryZoneId,
        deliveryZoneName,
        deliveryWindow,
        assignedCourierName: null,
        assignedCourierPhone: null,
        fulfillmentNotes,
        shippingFee: this.toMoney(shippingFee),
        estimatedFulfillmentAt,
        subtotal: this.toMoney(subtotal),
        discountTotal: this.toMoney(discountTotal),
        total: this.toMoney(total),
        currency: cart.currency,
        items: lockedCartItems.map((item) =>
          transactionalOrderItemsRepository.create({
            productId: item.productId,
            productVariantId: item.productVariantId ?? null,
            productName: item.productNameSnapshot,
            sku: item.skuSnapshot,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          }),
        ),
      });

      const persistedOrder = await transactionalOrdersRepository.save(order);
      await this.appendStatusHistory(transactionalOrderStatusHistoryRepository, {
        orderId: persistedOrder.id,
        previousStatus: null,
        nextStatus: OrderLifecycleStatus.PENDING,
        changedByUserId: actor.userId,
        source: 'checkout',
        note: 'Order created and waiting for payment',
        metadata: {
          fulfillmentType: persistedOrder.fulfillmentType,
          total: persistedOrder.total,
          currency: persistedOrder.currency,
        },
      });

      await transactionalCartItemsRepository.delete({ cartId: transactionalCart.id });
      await transactionalCartsRepository.update(
        { id: transactionalCart.id },
        {
          status: CartStatus.ORDERED,
          subtotal: this.toMoney(0),
          discountTotal: this.toMoney(0),
          total: this.toMoney(0),
        },
      );
      return persistedOrder;
    });

    if (couponId) {
      await this.couponsService.registerCouponUsage(couponId);
    }

    return this.getOrderWithHistory(savedOrder.id);
  }

  async listMyOrders(actor: Actor): Promise<Order[]> {
    const orders = await this.ordersRepository.find({
      where: { userId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    return this.normalizeOrdersWithBillingStatus(orders);
  }

  async listTenantOrders(query: ListTenantOrdersDto, actor: Actor): Promise<Order[]> {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      if (!query.tenantId) {
        const orders = await this.ordersRepository.find({ order: { createdAt: 'DESC' } });
        return this.normalizeOrdersWithBillingStatus(orders);
      }
      const orders = await this.ordersRepository.find({
        where: { tenantId: query.tenantId },
        order: { createdAt: 'DESC' },
      });
      return this.normalizeOrdersWithBillingStatus(orders);
    }

    if (!actor.tenantId) {
      return [];
    }

    const orders = await this.ordersRepository.find({
      where: { tenantId: actor.tenantId },
      order: { createdAt: 'DESC' },
    });
    return this.normalizeOrdersWithBillingStatus(orders);
  }

  async findOrder(orderId: string, actor: Actor): Promise<Order> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }

    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      const [normalized] = await this.normalizeOrdersWithBillingStatus([order]);
      return normalized;
    }

    if (
      actor.role === UserRole.TENANT_ADMIN ||
      actor.role === UserRole.ORDER_MANAGER ||
      actor.role === UserRole.SUPPORT
    ) {
      if (!actor.tenantId || actor.tenantId !== order.tenantId) {
        throw new NotFoundException('Orden no encontrada');
      }
      const [normalized] = await this.normalizeOrdersWithBillingStatus([order]);
      return normalized;
    }

    if (order.userId !== actor.userId) {
      throw new NotFoundException('Orden no encontrada');
    }

    const [normalized] = await this.normalizeOrdersWithBillingStatus([order]);
    return normalized;
  }

  async markOrderAsPaid(orderId: string, paymentProvider: string, paymentReference: string): Promise<Order> {
    let notifyPaid = false;
    const savedOrder = await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalOrderItemsRepository = manager.getRepository(OrderItem);
      const transactionalProductsRepository = manager.getRepository(Product);
      const transactionalProductVariantsRepository = manager.getRepository(ProductVariant);
      const transactionalOrderStatusHistoryRepository = manager.getRepository(OrderStatusHistory);

      const order = await transactionalOrdersRepository
        .createQueryBuilder('ord')
        .setLock('pessimistic_write')
        .where('ord.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new NotFoundException('Orden no encontrada');
      }

      if (order.status === OrderStatus.PAID) {
        return this.normalizeOrder(order);
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException('La orden esta cancelada y no puede pagarse');
      }

      const lockedOrderItems = await transactionalOrderItemsRepository
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.orderId = :orderId', { orderId: order.id })
        .getMany();

      if (!lockedOrderItems.length) {
        throw new ConflictException('La orden no tiene items');
      }

      await this.consumeReservedStockForOrderItems(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        lockedOrderItems,
      );

      order.status = OrderStatus.PAID;
      order.paymentStatus = 'paid';
      order.fulfillmentStatus = FulfillmentStatus.PENDING;
      order.paymentProvider = paymentProvider;
      order.paymentReference = paymentReference;
      const previousLifecycleStatus = this.resolvePreviousLifecycleStatus(order, OrderLifecycleStatus.PAID);
      this.setLifecycleStatus(order, OrderLifecycleStatus.PAID);

      await this.appendStatusHistory(transactionalOrderStatusHistoryRepository, {
        orderId: order.id,
        previousStatus: previousLifecycleStatus,
        nextStatus: OrderLifecycleStatus.PAID,
        changedByUserId: null,
        source: 'payment',
        note: 'Payment confirmed',
        metadata: {
          paymentProvider,
          paymentReference,
        },
      });

      const savedOrder = await transactionalOrdersRepository.save(order);
      notifyPaid = true;
      return this.normalizeOrder(savedOrder);
    });

    if (notifyPaid) {
      await this.notifyOrderPaid(savedOrder.id);
    }

    return this.getOrderWithHistory(savedOrder.id);
  }

  async updateFulfillmentStatus(orderId: string, dto: UpdateFulfillmentStatusDto, actor: Actor): Promise<Order> {
    const authorizedOrder = await this.findOrder(orderId, actor);
    let shouldNotifyLifecycle = false;
    let previousLifecycleStatus: OrderLifecycleStatus | null = null;
    let nextLifecycleStatus: OrderLifecycleStatus | null = null;

    const savedOrder = await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalOrderStatusHistoryRepository = manager.getRepository(OrderStatusHistory);

      const order = await transactionalOrdersRepository
        .createQueryBuilder('ord')
        .setLock('pessimistic_write')
        .where('ord.id = :orderId', { orderId: authorizedOrder.id })
        .getOne();

      if (!order) {
        throw new NotFoundException('Orden no encontrada');
      }

      if (order.status !== OrderStatus.PAID) {
        throw new ConflictException('La orden debe estar pagada antes de actualizar el cumplimiento');
      }

      if (!this.isAllowedFulfillmentTransition(order.fulfillmentType, order.fulfillmentStatus, dto.status)) {
        throw new ConflictException(
          `Transicion de estado de cumplimiento invalida: ${order.fulfillmentStatus} -> ${dto.status}`,
        );
      }

      order.fulfillmentStatus = dto.status;
      if (dto.assignedCourierName !== undefined) {
        order.assignedCourierName = this.normalizeOptionalString(dto.assignedCourierName);
      }
      if (dto.assignedCourierPhone !== undefined) {
        order.assignedCourierPhone = this.normalizeOptionalString(dto.assignedCourierPhone);
      }

      const derivedLifecycleStatus = this.resolveLifecycleStatusFromFulfillment(order, dto.status);
      const previous = this.resolvePreviousLifecycleStatus(order, derivedLifecycleStatus);
      this.setLifecycleStatus(order, derivedLifecycleStatus);

      if (previous !== derivedLifecycleStatus) {
        await this.appendStatusHistory(transactionalOrderStatusHistoryRepository, {
          orderId: order.id,
          previousStatus: previous,
          nextStatus: derivedLifecycleStatus,
          changedByUserId: actor.userId,
          source: 'fulfillment',
          note: `Fulfillment status changed to ${dto.status}`,
          metadata: {
            fulfillmentStatus: dto.status,
          },
        });
        shouldNotifyLifecycle = true;
        previousLifecycleStatus = previous;
        nextLifecycleStatus = derivedLifecycleStatus;
      }

      return this.normalizeOrder(await transactionalOrdersRepository.save(order));
    });

    if (shouldNotifyLifecycle && previousLifecycleStatus && nextLifecycleStatus) {
      await this.notifyLifecycleStatusChanged(savedOrder.id, previousLifecycleStatus, nextLifecycleStatus);
    }

    return this.getOrderWithHistory(savedOrder.id);
  }

  async cancelOrderForPaymentFailure(
    orderId: string,
    source: LifecycleChangeSource,
    note: string,
  ): Promise<Order> {
    let lifecycleChanged = false;
    let previousLifecycleStatus: OrderLifecycleStatus | null = null;

    const savedOrder = await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalOrderItemsRepository = manager.getRepository(OrderItem);
      const transactionalProductsRepository = manager.getRepository(Product);
      const transactionalProductVariantsRepository = manager.getRepository(ProductVariant);
      const transactionalOrderStatusHistoryRepository = manager.getRepository(OrderStatusHistory);

      const order = await transactionalOrdersRepository
        .createQueryBuilder('ord')
        .setLock('pessimistic_write')
        .where('ord.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new NotFoundException('Orden no encontrada');
      }

      if (order.status === OrderStatus.CANCELLED) {
        return this.normalizeOrder(order);
      }

      if (order.status === OrderStatus.PAID) {
        return this.normalizeOrder(order);
      }

      const lockedOrderItems = await transactionalOrderItemsRepository
        .createQueryBuilder('item')
        .setLock('pessimistic_write')
        .where('item.orderId = :orderId', { orderId: order.id })
        .getMany();

      await this.releaseReservedStockForOrderItems(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        lockedOrderItems,
      );

      order.status = OrderStatus.CANCELLED;
      order.paymentStatus = 'failed';
      order.fulfillmentStatus = FulfillmentStatus.FAILED;

      previousLifecycleStatus = this.resolvePreviousLifecycleStatus(order, OrderLifecycleStatus.CANCELLED);
      this.setLifecycleStatus(order, OrderLifecycleStatus.CANCELLED);

      if (previousLifecycleStatus !== OrderLifecycleStatus.CANCELLED) {
        await this.appendStatusHistory(transactionalOrderStatusHistoryRepository, {
          orderId: order.id,
          previousStatus: previousLifecycleStatus,
          nextStatus: OrderLifecycleStatus.CANCELLED,
          changedByUserId: null,
          source,
          note,
          metadata: {
            paymentStatus: order.paymentStatus,
          },
        });
        lifecycleChanged = true;
      }

      return this.normalizeOrder(await transactionalOrdersRepository.save(order));
    });

    if (lifecycleChanged && previousLifecycleStatus) {
      await this.notifyLifecycleStatusChanged(savedOrder.id, previousLifecycleStatus, OrderLifecycleStatus.CANCELLED);
    }

    return this.getOrderWithHistory(savedOrder.id);
  }

  private async computeCheckout(
    actor: Actor,
    checkoutDto: CheckoutDto,
    options: ComputeCheckoutOptions,
  ): Promise<CheckoutComputation> {
    const cart = await this.cartService.getMyCart(actor, checkoutDto.tenantId);
    if (!cart.items.length) {
      throw new BadRequestException('El carrito esta vacio');
    }

    if (cart.status !== CartStatus.ACTIVE) {
      throw new ConflictException('El carrito no esta activo');
    }

    for (const item of cart.items) {
      const product = await this.productsRepository.findOne({ where: { id: item.productId } });
      if (!product || !product.isActive || product.tenantId !== cart.tenantId) {
        throw new ConflictException(`Producto no disponible: ${item.productNameSnapshot}`);
      }
      let availableStock = product.stock - Math.max(product.reservedStock ?? 0, 0);
      if (item.productVariantId) {
        const variant = await this.productVariantsRepository.findOne({
          where: {
            id: item.productVariantId,
            productId: product.id,
          },
        });
        if (!variant || !variant.isActive) {
          throw new ConflictException(`Producto no disponible: ${item.productNameSnapshot}`);
        }
        availableStock = variant.stock - Math.max(variant.reservedStock ?? 0, 0);
      }
      if (availableStock < item.quantity) {
        throw new ConflictException(`Stock insuficiente para el producto: ${item.productNameSnapshot}`);
      }
    }

    const subtotal = Number(cart.subtotal);
    let discountTotal = 0;
    let couponCode: string | null = null;
    let couponId: string | null = null;
    let couponEvaluation: CheckoutComputation['couponEvaluation'] = null;

    if (checkoutDto.couponCode) {
      const couponItems = cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }));
      const evaluated = options.strictCouponEligibility
        ? await this.couponsService.evaluateCoupon(cart.tenantId, checkoutDto.couponCode, subtotal, couponItems)
        : await this.couponsService.inspectCoupon(cart.tenantId, checkoutDto.couponCode, subtotal, couponItems);

      discountTotal = evaluated.discountAmount;
      couponCode = evaluated.coupon.code;
      couponId = evaluated.eligible ? evaluated.coupon.id : null;
      couponEvaluation = {
        code: evaluated.coupon.code,
        eligible: evaluated.eligible,
        discountAmount: this.toMoney(evaluated.discountAmount),
        feedback: evaluated.feedback,
      };
    }

    const {
      fulfillmentType,
      shippingFee,
      deliveryAddress,
      pickupDetails,
      fulfillmentNotes,
      estimatedFulfillmentAt,
      deliveryZoneId,
      deliveryZoneName,
      deliveryWindow,
    } = await this.normalizeFulfillment(
      cart.tenantId,
      checkoutDto,
      options.enforceFulfillmentDetails,
      Math.max(subtotal - discountTotal, 0),
    );
    const billingDetails = this.normalizeBillingDetails(checkoutDto.billing);

    const total = Math.max(subtotal - discountTotal + shippingFee, 0);

    return {
      cart,
      subtotal,
      discountTotal,
      shippingFee,
      total,
      couponCode,
      couponId,
      fulfillmentType,
      deliveryAddress,
      pickupDetails,
      billingDetails,
      fulfillmentNotes,
      estimatedFulfillmentAt,
      deliveryZoneId,
      deliveryZoneName,
      deliveryWindow,
      couponEvaluation,
    };
  }

  private async normalizeFulfillment(
    tenantId: string,
    checkoutDto: CheckoutDto,
    enforceDetails: boolean,
    subtotalAfterDiscount: number,
  ): Promise<{
    fulfillmentType: FulfillmentType;
    shippingFee: number;
    deliveryAddress: DeliveryAddress | null;
    pickupDetails: PickupDetails | null;
    fulfillmentNotes: string | null;
    estimatedFulfillmentAt: Date | null;
    deliveryZoneId: string | null;
    deliveryZoneName: string | null;
    deliveryWindow: string | null;
  }> {
    const fulfillmentType = checkoutDto.fulfillmentType ?? FulfillmentType.DELIVERY;
    const fulfillmentNotes = this.normalizeOptionalString(checkoutDto.fulfillmentNotes);

    if (fulfillmentType === FulfillmentType.DELIVERY) {
      const deliveryAddress = this.normalizeDeliveryAddress(checkoutDto.shippingAddress);
      if (enforceDetails && !deliveryAddress) {
        throw new BadRequestException('shippingAddress es obligatorio para ordenes de delivery');
      }

      const district = deliveryAddress?.district ?? this.normalizeOptionalString(checkoutDto.deliveryDistrict);
      const deliveryWindow = this.normalizeOptionalString(checkoutDto.deliveryWindow);
      if (enforceDetails && !district) {
        throw new BadRequestException('El distrito de entrega es obligatorio para ordenes de delivery');
      }

      let shippingFee = this.defaultDeliveryFee;
      let estimatedFulfillmentAt = this.estimateFulfillmentAt(fulfillmentType);
      let deliveryZoneId: string | null = null;
      let deliveryZoneName: string | null = null;

      if (district) {
        const coverage = await this.deliveryZonesService.resolveCoverage(tenantId, district, subtotalAfterDiscount);
        shippingFee = coverage.shippingFee;
        estimatedFulfillmentAt = new Date(Date.now() + coverage.estimatedMinutes * 60 * 1000);
        deliveryZoneId = coverage.zone.id;
        deliveryZoneName = coverage.zone.name;
      }

      return {
        fulfillmentType,
        shippingFee,
        deliveryAddress,
        pickupDetails: null,
        fulfillmentNotes,
        estimatedFulfillmentAt,
        deliveryZoneId,
        deliveryZoneName,
        deliveryWindow,
      };
    }

    const pickupDetails = await this.normalizePickupDetails(tenantId, checkoutDto.pickup);
    if (enforceDetails && !pickupDetails) {
      throw new BadRequestException('Los datos de recojo son obligatorios para ordenes pickup');
    }

    const pickupEta = pickupDetails?.scheduledAt ? new Date(pickupDetails.scheduledAt) : this.estimateFulfillmentAt(fulfillmentType);
    return {
      fulfillmentType,
      shippingFee: 0,
      deliveryAddress: null,
      pickupDetails,
      fulfillmentNotes,
      estimatedFulfillmentAt: pickupEta,
      deliveryZoneId: null,
      deliveryZoneName: null,
      deliveryWindow: null,
    };
  }

  private normalizeBillingDetails(billing?: BillingDetailsDto): BillingDetails | null {
    if (!billing) {
      return null;
    }

    const documentType = billing.documentType;
    const customerDocumentType = this.normalizeOptionalString(billing.customerDocumentType);
    const customerDocumentNumber = this.normalizeOptionalString(billing.customerDocumentNumber);
    const customerName = this.normalizeOptionalString(billing.customerName);
    const customerAddress = this.normalizeOptionalString(billing.customerAddress);
    if (!customerDocumentType || !customerDocumentNumber || !customerName) {
      throw new BadRequestException('Completa los datos del comprobante');
    }

    const normalizedDocumentType = customerDocumentType.toUpperCase();
    if (documentType === 'invoice') {
      if (normalizedDocumentType !== 'RUC') {
        throw new BadRequestException('Para factura, el tipo de documento debe ser RUC');
      }
      if (!/^\d{11}$/.test(customerDocumentNumber)) {
        throw new BadRequestException('Para factura, el RUC debe tener 11 digitos');
      }
      if (!customerAddress) {
        throw new BadRequestException('Para factura, la direccion fiscal es obligatoria');
      }
    }

    return {
      documentType,
      customerDocumentType: normalizedDocumentType,
      customerDocumentNumber,
      customerName,
      customerEmail: this.normalizeOptionalString(billing.customerEmail) ?? null,
      customerAddress,
    };
  }

  private normalizeDeliveryAddress(shippingAddress?: DeliveryAddressDto): DeliveryAddress | null {
    if (!shippingAddress) {
      return null;
    }

    const fullName = this.normalizeOptionalString(shippingAddress.fullName);
    const phone = this.normalizeOptionalString(shippingAddress.phone);
    const line1 = this.normalizeOptionalString(shippingAddress.line1);
    const district = this.normalizeOptionalString(shippingAddress.district);
    const city = this.normalizeOptionalString(shippingAddress.city);
    if (!fullName || !phone || !line1 || !district || !city) {
      return null;
    }

    return {
      fullName,
      phone,
      line1,
      district,
      city,
      line2: this.normalizeOptionalString(shippingAddress.line2),
      reference: this.normalizeOptionalString(shippingAddress.reference),
    };
  }

  private async normalizePickupDetails(tenantId: string, pickup?: PickupDetailsDto): Promise<PickupDetails | null> {
    if (!pickup) {
      return null;
    }

    const pointId = this.normalizeOptionalString(pickup.pickupPointId);
    const windowLabel = this.normalizeOptionalString(pickup.windowLabel);
    const scheduledAt = this.normalizeOptionalString(pickup.scheduledAt);
    if (!pointId || !windowLabel) {
      return null;
    }
    if (scheduledAt) {
      throw new BadRequestException('La hora exacta de recojo no es editable. Selecciona una franja disponible.');
    }

    const pickupPoint = await this.pickupPointsService.findActiveForTenant(tenantId, pointId);
    if (pickupPoint.windows.length > 0 && !pickupPoint.windows.includes(windowLabel)) {
      throw new ConflictException('La franja de recojo no esta disponible para el punto seleccionado');
    }

    return {
      pointId: pickupPoint.id,
      pointName: pickupPoint.name,
      windowLabel,
      pointAddress: this.normalizeOptionalString(pickupPoint.address ?? undefined),
      scheduledAt: null,
    };
  }

  private normalizeOptionalString(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private estimateFulfillmentAt(fulfillmentType: FulfillmentType): Date {
    const hours = fulfillmentType === FulfillmentType.DELIVERY ? this.deliveryEtaHours : this.pickupEtaHours;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private isAllowedFulfillmentTransition(
    fulfillmentType: FulfillmentType,
    currentStatus: FulfillmentStatus,
    nextStatus: FulfillmentStatus,
  ): boolean {
    if (currentStatus === nextStatus) {
      return true;
    }

    const deliveryFlow: Record<FulfillmentStatus, FulfillmentStatus[]> = {
      [FulfillmentStatus.PENDING]: [FulfillmentStatus.PREPARING, FulfillmentStatus.READY_FOR_DISPATCH],
      [FulfillmentStatus.PREPARING]: [FulfillmentStatus.READY_FOR_DISPATCH, FulfillmentStatus.FAILED],
      [FulfillmentStatus.READY_FOR_DISPATCH]: [FulfillmentStatus.ON_THE_WAY, FulfillmentStatus.FAILED],
      [FulfillmentStatus.ON_THE_WAY]: [FulfillmentStatus.COMPLETED, FulfillmentStatus.FAILED],
      [FulfillmentStatus.READY_FOR_PICKUP]: [],
      [FulfillmentStatus.COMPLETED]: [],
      [FulfillmentStatus.FAILED]: [],
    };

    const pickupFlow: Record<FulfillmentStatus, FulfillmentStatus[]> = {
      [FulfillmentStatus.PENDING]: [FulfillmentStatus.READY_FOR_PICKUP],
      [FulfillmentStatus.PREPARING]: [FulfillmentStatus.READY_FOR_PICKUP, FulfillmentStatus.FAILED],
      [FulfillmentStatus.READY_FOR_DISPATCH]: [],
      [FulfillmentStatus.ON_THE_WAY]: [],
      [FulfillmentStatus.READY_FOR_PICKUP]: [FulfillmentStatus.COMPLETED, FulfillmentStatus.FAILED],
      [FulfillmentStatus.COMPLETED]: [],
      [FulfillmentStatus.FAILED]: [],
    };

    const flow = fulfillmentType === FulfillmentType.DELIVERY ? deliveryFlow : pickupFlow;
    return flow[currentStatus]?.includes(nextStatus) ?? false;
  }

  private async reserveStockForOrderItems(
    transactionalProductsRepository: Repository<Product>,
    transactionalProductVariantsRepository: Repository<ProductVariant>,
    items: Array<{ productId: string; productVariantId?: string | null; quantity: number }>,
  ): Promise<void> {
    const quantitiesByProduct = this.buildQuantitiesByProduct(items);
    const quantitiesByVariant = this.buildQuantitiesByVariant(items);
    const products = await this.loadProductsWithLock(transactionalProductsRepository, [...quantitiesByProduct.keys()]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const variants = await this.loadVariantsWithLock(transactionalProductVariantsRepository, [...quantitiesByVariant.keys()]);
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const affectedProductIds = new Set<string>();

    for (const [productId, requiredQuantity] of quantitiesByProduct) {
      const product = productsById.get(productId);
      if (!product) {
        throw new ConflictException(`Falta el producto para el item de orden ${productId}`);
      }
      const availableStock = product.stock - Math.max(product.reservedStock ?? 0, 0);
      if (availableStock < requiredQuantity) {
        throw new ConflictException(`Stock insuficiente para el producto: ${product.name}`);
      }
    }

    for (const [productId, requiredQuantity] of quantitiesByProduct) {
      const product = productsById.get(productId)!;
      product.reservedStock = Math.max(product.reservedStock ?? 0, 0) + requiredQuantity;
      await transactionalProductsRepository.save(product);
    }

    for (const [variantId, requiredQuantity] of quantitiesByVariant) {
      const variant = variantsById.get(variantId);
      if (!variant || !variant.isActive) {
        throw new ConflictException(`Falta la variante para el item de orden ${variantId}`);
      }
      const availableStock = variant.stock - Math.max(variant.reservedStock ?? 0, 0);
      if (availableStock < requiredQuantity) {
        throw new ConflictException(`Stock insuficiente para la variante: ${variant.name}`);
      }
    }

    for (const [variantId, requiredQuantity] of quantitiesByVariant) {
      const variant = variantsById.get(variantId)!;
      variant.reservedStock = Math.max(variant.reservedStock ?? 0, 0) + requiredQuantity;
      await transactionalProductVariantsRepository.save(variant);
      affectedProductIds.add(variant.productId);
    }

    if (affectedProductIds.size > 0) {
      await this.syncProductsFromVariants(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        [...affectedProductIds],
      );
    }
  }

  private async consumeReservedStockForOrderItems(
    transactionalProductsRepository: Repository<Product>,
    transactionalProductVariantsRepository: Repository<ProductVariant>,
    items: Array<{ productId: string; productVariantId?: string | null; quantity: number }>,
  ): Promise<void> {
    const quantitiesByProduct = this.buildQuantitiesByProduct(items);
    const quantitiesByVariant = this.buildQuantitiesByVariant(items);
    const products = await this.loadProductsWithLock(transactionalProductsRepository, [...quantitiesByProduct.keys()]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const variants = await this.loadVariantsWithLock(transactionalProductVariantsRepository, [...quantitiesByVariant.keys()]);
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const affectedProductIds = new Set<string>();

    for (const [productId, requiredQuantity] of quantitiesByProduct) {
      const product = productsById.get(productId);
      if (!product) {
        throw new ConflictException(`Falta el producto para el item de orden ${productId}`);
      }

      const reservedStock = Math.max(product.reservedStock ?? 0, 0);
      if (reservedStock < requiredQuantity) {
        throw new ConflictException(`Inconsistencia de stock reservado para el producto: ${product.name}`);
      }
      if (product.stock < requiredQuantity) {
        throw new ConflictException(`Stock insuficiente para el producto: ${product.name}`);
      }
    }

    for (const [productId, requiredQuantity] of quantitiesByProduct) {
      const product = productsById.get(productId)!;
      product.stock -= requiredQuantity;
      product.reservedStock = Math.max(product.reservedStock - requiredQuantity, 0);
      await transactionalProductsRepository.save(product);
    }

    for (const [variantId, requiredQuantity] of quantitiesByVariant) {
      const variant = variantsById.get(variantId);
      if (!variant || !variant.isActive) {
        throw new ConflictException(`Falta la variante para el item de orden ${variantId}`);
      }
      const reservedStock = Math.max(variant.reservedStock ?? 0, 0);
      if (reservedStock < requiredQuantity) {
        throw new ConflictException(`Inconsistencia de stock reservado para la variante: ${variant.name}`);
      }
      if (variant.stock < requiredQuantity) {
        throw new ConflictException(`Stock insuficiente para la variante: ${variant.name}`);
      }
    }

    for (const [variantId, requiredQuantity] of quantitiesByVariant) {
      const variant = variantsById.get(variantId)!;
      variant.stock -= requiredQuantity;
      variant.reservedStock = Math.max(variant.reservedStock - requiredQuantity, 0);
      await transactionalProductVariantsRepository.save(variant);
      affectedProductIds.add(variant.productId);
    }

    if (affectedProductIds.size > 0) {
      await this.syncProductsFromVariants(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        [...affectedProductIds],
      );
    }
  }

  private async releaseReservedStockForOrderItems(
    transactionalProductsRepository: Repository<Product>,
    transactionalProductVariantsRepository: Repository<ProductVariant>,
    items: Array<{ productId: string; productVariantId?: string | null; quantity: number }>,
  ): Promise<void> {
    const quantitiesByProduct = this.buildQuantitiesByProduct(items);
    const quantitiesByVariant = this.buildQuantitiesByVariant(items);
    const products = await this.loadProductsWithLock(transactionalProductsRepository, [...quantitiesByProduct.keys()]);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const variants = await this.loadVariantsWithLock(transactionalProductVariantsRepository, [...quantitiesByVariant.keys()]);
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
    const affectedProductIds = new Set<string>();

    for (const [productId, requiredQuantity] of quantitiesByProduct) {
      const product = productsById.get(productId);
      if (!product) {
        continue;
      }
      product.reservedStock = Math.max(Math.max(product.reservedStock ?? 0, 0) - requiredQuantity, 0);
      await transactionalProductsRepository.save(product);
    }

    for (const [variantId, requiredQuantity] of quantitiesByVariant) {
      const variant = variantsById.get(variantId);
      if (!variant) {
        continue;
      }
      variant.reservedStock = Math.max(Math.max(variant.reservedStock ?? 0, 0) - requiredQuantity, 0);
      await transactionalProductVariantsRepository.save(variant);
      affectedProductIds.add(variant.productId);
    }

    if (affectedProductIds.size > 0) {
      await this.syncProductsFromVariants(
        transactionalProductsRepository,
        transactionalProductVariantsRepository,
        [...affectedProductIds],
      );
    }
  }

  private async loadProductsWithLock(
    repository: Repository<Product>,
    productIds: string[],
  ): Promise<Product[]> {
    if (!productIds.length) {
      return [];
    }

    return repository
      .createQueryBuilder('product')
      .where('product.id IN (:...productIds)', { productIds })
      .setLock('pessimistic_write')
      .getMany();
  }

  private async loadVariantsWithLock(
    repository: Repository<ProductVariant>,
    variantIds: string[],
  ): Promise<ProductVariant[]> {
    if (!variantIds.length) {
      return [];
    }

    return repository
      .createQueryBuilder('variant')
      .where('variant.id IN (:...variantIds)', { variantIds })
      .setLock('pessimistic_write')
      .getMany();
  }

  private buildQuantitiesByProduct(
    items: Array<{ productId: string; productVariantId?: string | null; quantity: number }>,
  ): Map<string, number> {
    const quantitiesByProduct = new Map<string, number>();
    for (const item of items) {
      if (item.productVariantId) {
        continue;
      }
      quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity);
    }
    return quantitiesByProduct;
  }

  private buildQuantitiesByVariant(
    items: Array<{ productId: string; productVariantId?: string | null; quantity: number }>,
  ): Map<string, number> {
    const quantitiesByVariant = new Map<string, number>();
    for (const item of items) {
      if (!item.productVariantId) {
        continue;
      }
      quantitiesByVariant.set(item.productVariantId, (quantitiesByVariant.get(item.productVariantId) ?? 0) + item.quantity);
    }
    return quantitiesByVariant;
  }

  private async syncProductsFromVariants(
    productsRepository: Repository<Product>,
    variantsRepository: Repository<ProductVariant>,
    productIds: string[],
  ): Promise<void> {
    if (!productIds.length) {
      return;
    }

    const [products, variants] = await Promise.all([
      productsRepository.findBy({ id: In(productIds) }),
      variantsRepository.findBy({ productId: In(productIds) }),
    ]);

    const variantsByProductId = new Map<string, ProductVariant[]>();
    for (const variant of variants) {
      const current = variantsByProductId.get(variant.productId) ?? [];
      current.push(variant);
      variantsByProductId.set(variant.productId, current);
    }

    for (const product of products) {
      const activeVariants = (variantsByProductId.get(product.id) ?? []).filter((variant) => variant.isActive);
      if (!activeVariants.length) {
        product.price = '0.00';
        product.stock = 0;
        product.reservedStock = 0;
        continue;
      }
      product.price = Math.min(...activeVariants.map((variant) => Number(variant.price))).toFixed(2);
      product.stock = activeVariants.reduce((sum, variant) => sum + variant.stock, 0);
      product.reservedStock = activeVariants.reduce((sum, variant) => sum + Math.max(variant.reservedStock ?? 0, 0), 0);
    }

    if (products.length) {
      await productsRepository.save(products);
    }
  }

  private async appendStatusHistory(
    repository: Repository<OrderStatusHistory>,
    payload: {
      orderId: string;
      previousStatus: OrderLifecycleStatus | null;
      nextStatus: OrderLifecycleStatus;
      changedByUserId: string | null;
      source: LifecycleChangeSource | 'migration';
      note: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await repository.save(
      repository.create({
        orderId: payload.orderId,
        previousStatus: payload.previousStatus,
        nextStatus: payload.nextStatus,
        changedByUserId: payload.changedByUserId,
        source: payload.source,
        note: payload.note,
        metadata: payload.metadata ?? null,
      }),
    );
  }

  private resolveLifecycleStatusFromFulfillment(
    order: Order,
    nextFulfillmentStatus: FulfillmentStatus,
  ): OrderLifecycleStatus {
    if (order.status === OrderStatus.CANCELLED) {
      return OrderLifecycleStatus.CANCELLED;
    }

    if (nextFulfillmentStatus === FulfillmentStatus.COMPLETED) {
      return OrderLifecycleStatus.DELIVERED;
    }

    if (nextFulfillmentStatus === FulfillmentStatus.ON_THE_WAY || nextFulfillmentStatus === FulfillmentStatus.READY_FOR_DISPATCH) {
      return OrderLifecycleStatus.SHIPPED;
    }

    if (nextFulfillmentStatus === FulfillmentStatus.PREPARING || nextFulfillmentStatus === FulfillmentStatus.READY_FOR_PICKUP) {
      return OrderLifecycleStatus.PREPARING;
    }

    if (order.paymentStatus === 'paid') {
      return OrderLifecycleStatus.PAID;
    }

    return OrderLifecycleStatus.PENDING;
  }

  private resolvePreviousLifecycleStatus(order: Order, fallback: OrderLifecycleStatus): OrderLifecycleStatus | null {
    return order.lifecycleStatus ?? fallback ?? null;
  }

  private setLifecycleStatus(order: Order, nextStatus: OrderLifecycleStatus): void {
    order.lifecycleStatus = nextStatus;
  }

  private async getOrderWithHistory(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }

    const [normalized] = await this.normalizeOrdersWithBillingStatus([order]);
    return normalized;
  }

  private normalizeOrder(order: Order): Order {
    if (Array.isArray(order.statusHistory)) {
      order.statusHistory = [...order.statusHistory].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    } else {
      order.statusHistory = [];
    }
    return order;
  }

  private async normalizeOrdersWithBillingStatus(orders: Order[]): Promise<Order[]> {
    const normalizedOrders = orders.map((order) => this.normalizeOrder(order));
    if (!normalizedOrders.length) {
      return normalizedOrders;
    }

    const orderIds = normalizedOrders.map((order) => order.id);
    const tenantIds = [...new Set(normalizedOrders.map((order) => order.tenantId))];

    const [documents, activeSettings] = await Promise.all([
      this.billingDocumentsRepository.find({
        where: {
          orderId: In(orderIds),
          kind: In([BillingDocumentKind.RECEIPT, BillingDocumentKind.INVOICE]),
        },
        order: { createdAt: 'DESC' },
      }),
      this.billingSettingsRepository.find({
        where: {
          tenantId: In(tenantIds),
          isActive: true,
        },
        select: ['tenantId'],
      }),
    ]);

    const latestDocumentByOrder = new Map<string, BillingDocument>();
    for (const document of documents) {
      if (!document.orderId || latestDocumentByOrder.has(document.orderId)) {
        continue;
      }
      latestDocumentByOrder.set(document.orderId, document);
    }

    const tenantWithBillingEnabled = new Set(activeSettings.map((entry) => entry.tenantId));

    return normalizedOrders.map((order) => {
      const shouldTrackBilling =
        order.status === OrderStatus.PAID ||
        order.paymentStatus === 'paid' ||
        order.paymentStatus === 'partially_refunded' ||
        order.paymentStatus === 'refunded';

      if (!shouldTrackBilling) {
        order.billingDocumentStatus = null;
        order.billingDocumentMessage = null;
        order.billingDocumentNumber = null;
        return order;
      }

      const document = latestDocumentByOrder.get(order.id);
      if (document) {
        order.billingDocumentStatus =
          document.status === BillingDocumentIssueStatus.ISSUED ? 'issued' : 'failed';
        order.billingDocumentMessage =
          document.status === BillingDocumentIssueStatus.ISSUED
            ? 'Comprobante emitido correctamente'
            : document.errorMessage || 'No se pudo emitir el comprobante';
        order.billingDocumentNumber = document.documentNumber;
        return order;
      }

      if (!tenantWithBillingEnabled.has(order.tenantId)) {
        order.billingDocumentStatus = 'missing_configuration';
        order.billingDocumentMessage =
          'Facturacion no configurada para esta tienda. Configura Billing > Settings para emitir boletas/facturas.';
        order.billingDocumentNumber = null;
        return order;
      }

      order.billingDocumentStatus = 'pending';
      order.billingDocumentMessage = 'Comprobante pendiente de emision.';
      order.billingDocumentNumber = null;
      return order;
    });
  }

  private async notifyOrderPaid(orderId: string): Promise<void> {
    if (!this.orderEmailService.isEnabled()) {
      return;
    }

    try {
      const enqueued = await this.jobsQueueService.enqueueOrderPaidEmail({ orderId });
      if (enqueued) {
        return;
      }
    } catch (error) {
      this.logger.warn(`No se pudo encolar correo de orden pagada ${orderId}: ${(error as Error).message}`);
    }

    try {
      await this.dispatchOrderPaidEmail(orderId);
    } catch (error) {
      this.logger.warn(`Fallo el correo de orden pagada para la orden ${orderId}: ${(error as Error).message}`);
    }
  }

  private async notifyLifecycleStatusChanged(
    orderId: string,
    previousStatus: OrderLifecycleStatus,
    nextStatus: OrderLifecycleStatus,
  ): Promise<void> {
    if (!this.orderEmailService.isEnabled()) {
      return;
    }

    try {
      const enqueued = await this.jobsQueueService.enqueueOrderStatusChangedEmail({
        orderId,
        previousStatus,
        nextStatus,
      });
      if (enqueued) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar correo de cambio de estado para orden ${orderId}: ${(error as Error).message}`,
      );
    }

    try {
      await this.dispatchOrderStatusChangedEmail(orderId, previousStatus, nextStatus);
    } catch (error) {
      this.logger.warn(`Fallo el correo de ciclo de vida para la orden ${orderId}: ${(error as Error).message}`);
    }
  }

  async dispatchOrderPaidEmail(orderId: string): Promise<void> {
    const order = await this.getOrderWithHistory(orderId);
    const contact = await this.loadOrderCustomerContact(order.userId);
    if (!contact) {
      return;
    }

    await this.orderEmailService.sendOrderPaidEmail({
      toEmail: contact.email,
      fullName: contact.fullName,
      orderId: order.id,
      total: order.total,
      currency: order.currency,
    });
  }

  async dispatchOrderStatusChangedEmail(
    orderId: string,
    previousStatus: OrderLifecycleStatus,
    nextStatus: OrderLifecycleStatus,
  ): Promise<void> {
    const order = await this.getOrderWithHistory(orderId);
    const contact = await this.loadOrderCustomerContact(order.userId);
    if (!contact) {
      return;
    }

    await this.orderEmailService.sendOrderStatusChangedEmail({
      toEmail: contact.email,
      fullName: contact.fullName,
      orderId: order.id,
      previousStatus,
      nextStatus,
    });
  }

  private async loadOrderCustomerContact(userId: string): Promise<{ email: string; fullName: string } | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'fullName', 'isActive'],
    });

    if (!user || !user.isActive) {
      return null;
    }

    return {
      email: user.email,
      fullName: user.fullName,
    };
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }
}
