import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, In, Repository } from 'typeorm';
import { JobsQueueService } from '../../queue/jobs-queue.service';
import { UserRole } from '../auth/enums/user-role.enum';
import { BillingService } from '../billing/billing.service';
import { Order } from '../orders/order.entity';
import { OrderStatus } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { PaymentRefund } from './entities/payment-refund.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
  email: string;
};

@Injectable()
export class PaymentsService {
  private stripeClient: Stripe | null = null;
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly ordersService: OrdersService,
    private readonly billingService: BillingService,
    @InjectRepository(PaymentTransaction)
    private readonly paymentsRepository: Repository<PaymentTransaction>,
    @InjectRepository(PaymentRefund)
    private readonly refundsRepository: Repository<PaymentRefund>,
    private readonly dataSource: DataSource,
    private readonly jobsQueueService: JobsQueueService,
  ) {}

  async createCheckoutSession(actor: Actor, createCheckoutSessionDto: CreateCheckoutSessionDto) {
    const order = await this.ordersService.findOrder(createCheckoutSessionDto.orderId, actor);
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new ConflictException('La orden no esta pendiente de pago');
    }
    if (!order.items.length) {
      throw new ConflictException('La orden no tiene items');
    }

    const successUrl =
      createCheckoutSessionDto.successUrl ??
      this.configService.get<string>('STRIPE_SUCCESS_URL') ??
      'http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl =
      createCheckoutSessionDto.cancelUrl ??
      this.configService.get<string>('STRIPE_CANCEL_URL') ??
      'http://localhost:3000/checkout/cancel';

    const shippingFee = Number(order.shippingFee ?? 0);
    const subtotalCents = Math.max(Math.round(Number(order.subtotal) * 100), 0);
    const discountCents = Math.max(Math.round(Number(order.discountTotal) * 100), 0);
    const boundedDiscountCents = Math.min(discountCents, subtotalCents);
    const itemLines = order.items.map((item) => ({
      item,
      lineCents: Math.max(Math.round(Number(item.lineTotal) * 100), 0),
    }));

    let remainingDiscount = boundedDiscountCents;
    const rawLineItems: Array<Stripe.Checkout.SessionCreateParams.LineItem | null> = itemLines
      .map((entry, index) => {
        let lineDiscount = 0;
        if (remainingDiscount > 0 && subtotalCents > 0) {
          const proportional = Math.floor((boundedDiscountCents * entry.lineCents) / subtotalCents);
          lineDiscount = Math.min(proportional, entry.lineCents, remainingDiscount);

          if (index === itemLines.length - 1) {
            lineDiscount = Math.min(remainingDiscount, entry.lineCents);
          }
        }

        remainingDiscount -= lineDiscount;
        const netLineAmount = Math.max(entry.lineCents - lineDiscount, 0);
        if (netLineAmount <= 0) {
          return null;
        }

        const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: netLineAmount,
            product_data: {
              name: `${entry.item.productName} x${entry.item.quantity}`,
              metadata: {
                productId: entry.item.productId,
              },
            },
          },
        };
        return lineItem;
      })
      .filter((lineItem) => lineItem !== null);
    const lineItems = rawLineItems.filter(
      (lineItem): lineItem is Stripe.Checkout.SessionCreateParams.LineItem => Boolean(lineItem),
    );

    if (shippingFee > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: Math.round(shippingFee * 100),
          product_data: {
            name: order.fulfillmentType === 'delivery' ? 'Costo de delivery' : 'Costo de envio',
          },
        },
      });
    }

    const stripe = this.getStripeClient();
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: order.id,
        customer_email: createCheckoutSessionDto.customerEmail ?? actor.email,
        line_items: lineItems,
        metadata: {
          orderId: order.id,
          tenantId: order.tenantId,
        },
        payment_intent_data: {
          metadata: {
            orderId: order.id,
            tenantId: order.tenantId,
          },
        },
      },
      {
        idempotencyKey: `checkout_order_${order.id}`,
      },
    );

    await this.upsertTransactionByExternalId({
      orderId: order.id,
      tenantId: order.tenantId,
      provider: 'stripe',
      status: 'created',
      eventType: 'checkout.session.created',
      externalId: session.id,
      amount: order.total,
      currency: order.currency,
      metadata: {
        checkoutSessionId: session.id,
      },
    });

    return {
      provider: 'stripe',
      orderId: order.id,
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
    };
  }

  async confirmCheckoutSession(actor: Actor, checkoutSessionId: string): Promise<{
    orderId: string;
    orderStatus: string;
    paymentStatus: string;
    checkoutSessionId: string;
    checkoutSessionStatus: string | null;
  }> {
    const stripe = this.getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ['payment_intent'],
    });

    const orderId = (session.metadata?.orderId ?? session.client_reference_id) as string | undefined;
    if (!orderId) {
      throw new BadRequestException('La sesion de checkout no incluye orderId');
    }

    const order = await this.ordersService.findOrder(orderId, actor);
    const isPaid = session.payment_status === 'paid';

    if (isPaid) {
      const paymentIntentRef =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? session.id;

      await this.ordersService.markOrderAsPaid(order.id, 'stripe', paymentIntentRef);
      await this.tryIssueBillingDocument(order.id, 'checkout_confirmation');
    }

    await this.upsertCheckoutSessionTransaction(
      order,
      session,
      isPaid ? 'paid' : session.payment_status ?? 'received',
      isPaid ? 'checkout.session.confirmed_paid' : 'checkout.session.confirmed',
    );

    return {
      orderId: order.id,
      orderStatus: isPaid ? OrderStatus.PAID : order.status,
      paymentStatus: isPaid ? 'paid' : session.payment_status ?? order.paymentStatus,
      checkoutSessionId: session.id,
      checkoutSessionStatus: session.status ?? null,
    };
  }

  async handleStripeWebhook(rawPayload: Buffer | string | object, stripeSignature?: string): Promise<void> {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    const isProduction = (this.configService.get<string>('NODE_ENV') ?? 'development').toLowerCase() === 'production';

    if (isProduction && !webhookSecret) {
      throw new InternalServerErrorException('STRIPE_WEBHOOK_SECRET es obligatorio en produccion');
    }

    const stripe = this.getStripeClient();

    let event: Stripe.Event;
    if (webhookSecret) {
      if (!stripeSignature) {
        throw new BadRequestException('Falta el encabezado stripe-signature');
      }

      const payloadBuffer = Buffer.isBuffer(rawPayload)
        ? rawPayload
        : Buffer.from(typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload));
      event = stripe.webhooks.constructEvent(payloadBuffer, stripeSignature, webhookSecret);
    } else {
      if (typeof rawPayload === 'object' && rawPayload && 'type' in rawPayload) {
        event = rawPayload as Stripe.Event;
      } else {
        const parsed = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : JSON.parse(rawPayload.toString());
        event = parsed as Stripe.Event;
      }
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = (session.metadata?.orderId ?? session.client_reference_id) as string | undefined;
        if (!orderId) {
          throw new BadRequestException('El evento webhook no incluye orderId');
        }

        await this.processWebhookEvent({
          orderId,
          event,
          status: session.payment_status === 'paid' ? 'paid' : 'received',
          paymentReference: session.payment_intent?.toString() ?? session.id,
        });
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = (session.metadata?.orderId ?? session.client_reference_id) as string | undefined;
        if (!orderId) {
          throw new BadRequestException('El evento webhook no incluye orderId');
        }

        await this.processWebhookEvent({
          orderId,
          event,
          status: 'failed',
          paymentReference: session.payment_intent?.toString() ?? session.id,
        });
        break;
      }

      case 'payment_intent.succeeded': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const orderId = intent.metadata?.orderId;
        if (orderId) {
          await this.processWebhookEvent({
            orderId,
            event,
            status: 'paid',
            paymentReference: intent.id,
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object as Stripe.PaymentIntent;
        const orderId = intent.metadata?.orderId;
        if (orderId) {
          await this.processWebhookEvent({
            orderId,
            event,
            status: 'failed',
            paymentReference: intent.id,
          });
        }
        break;
      }

      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const refund = event.data.object as Stripe.Refund;
        await this.processRefundWebhookEvent(refund, event.type);
        break;
      }

      default:
        this.logger.debug(`Ignored Stripe webhook event: ${event.type} (${event.id})`);
        break;
    }
  }

  async listOrderPayments(orderId: string, actor: Actor) {
    await this.ordersService.findOrder(orderId, actor);
    return this.paymentsRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async listOrderRefunds(orderId: string, actor: Actor) {
    await this.ordersService.findOrder(orderId, actor);
    return this.refundsRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async refundOrder(
    actor: Actor,
    orderId: string,
    createRefundDto: CreateRefundDto,
  ): Promise<{
    refundId: string;
    orderId: string;
    status: string;
    amount: string;
    currency: string;
    paymentStatus: string;
    externalId: string | null;
  }> {
    const authorizedOrder = await this.ordersService.findOrder(orderId, actor);

    const prepared = await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalRefundsRepository = manager.getRepository(PaymentRefund);

      const order = await transactionalOrdersRepository
        .createQueryBuilder('ord')
        .setLock('pessimistic_write')
        .where('ord.id = :orderId', { orderId: authorizedOrder.id })
        .getOne();
      if (!order) {
        throw new NotFoundException('Orden no encontrada');
      }

      if (order.status !== OrderStatus.PAID) {
        throw new ConflictException('Solo se pueden reembolsar ordenes pagadas');
      }

      if (order.paymentStatus === 'refunded') {
        throw new ConflictException('La orden ya fue reembolsada completamente');
      }

      if (order.paymentProvider !== 'stripe') {
        throw new ConflictException('Solo se admite reembolso para pagos con Stripe');
      }

      if (!order.paymentReference) {
        throw new ConflictException('La orden no tiene referencia de pago para reembolso');
      }

      const clientRequestId = createRefundDto.clientRequestId?.trim() || null;
      if (clientRequestId) {
        const existing = await transactionalRefundsRepository.findOne({
          where: {
            orderId: order.id,
            clientRequestId,
          },
        });

        if (existing) {
          return {
            alreadyExists: true,
            order,
            refund: existing,
          };
        }
      }

      const reservedRefunds = await transactionalRefundsRepository.find({
        where: {
          orderId: order.id,
          status: In(['pending', 'succeeded']),
        },
      });

      const reservedAmount = reservedRefunds.reduce((acc, entry) => acc + Number(entry.amount), 0);
      const orderTotal = Number(order.total);
      const remainingAmount = Number((orderTotal - reservedAmount).toFixed(2));
      if (remainingAmount <= 0) {
        throw new ConflictException('La orden ya no tiene monto disponible para reembolso');
      }

      const requestedAmount =
        createRefundDto.amount !== undefined ? Number(createRefundDto.amount.toFixed(2)) : remainingAmount;
      if (requestedAmount <= 0) {
        throw new BadRequestException('El monto de reembolso debe ser mayor a 0');
      }
      if (requestedAmount > remainingAmount) {
        throw new ConflictException('El monto supera el saldo disponible para reembolso');
      }

      const pendingRefund = await transactionalRefundsRepository.save(
        transactionalRefundsRepository.create({
          orderId: order.id,
          tenantId: order.tenantId,
          provider: 'stripe',
          status: 'pending',
          externalId: null,
          amount: this.toMoney(requestedAmount),
          currency: order.currency,
          reason: createRefundDto.reason?.trim() || null,
          requestedByUserId: actor.userId,
          clientRequestId,
          metadata: {
            paymentReference: order.paymentReference,
          },
        }),
      );

      return {
        alreadyExists: false,
        order,
        refund: pendingRefund,
      };
    });

    if (prepared.alreadyExists) {
      const latestOrder = await this.ordersService.findOrder(orderId, actor);
      return {
        refundId: prepared.refund.id,
        orderId: prepared.order.id,
        status: prepared.refund.status,
        amount: prepared.refund.amount,
        currency: prepared.refund.currency,
        paymentStatus: latestOrder.paymentStatus,
        externalId: prepared.refund.externalId,
      };
    }

    const stripe = this.getStripeClient();
    try {
      const stripeRefund = await stripe.refunds.create(
        {
          payment_intent: prepared.order.paymentReference ?? undefined,
          amount: this.toMinorUnits(Number(prepared.refund.amount)),
          metadata: {
            orderId: prepared.order.id,
            tenantId: prepared.order.tenantId,
            refundId: prepared.refund.id,
            requestedByUserId: actor.userId,
            reason: prepared.refund.reason ?? '',
          },
        },
        {
          idempotencyKey: `refund_${prepared.refund.id}`,
        },
      );

      const updatedRefund = await this.refundsRepository.save({
        ...prepared.refund,
        status: stripeRefund.status ?? 'succeeded',
        externalId: stripeRefund.id,
        metadata: stripeRefund as unknown as Record<string, unknown>,
      });

      await this.syncOrderPaymentStatusAfterRefund(prepared.order.id);
      if (updatedRefund.status === 'succeeded') {
        await this.tryIssueCreditNoteForRefund(updatedRefund, 'refund_manual');
      }
      const latestOrder = await this.ordersService.findOrder(orderId, actor);

      return {
        refundId: updatedRefund.id,
        orderId: prepared.order.id,
        status: updatedRefund.status,
        amount: updatedRefund.amount,
        currency: updatedRefund.currency,
        paymentStatus: latestOrder.paymentStatus,
        externalId: updatedRefund.externalId,
      };
    } catch (error) {
      await this.refundsRepository.update(
        { id: prepared.refund.id },
        {
          status: 'failed',
          metadata: {
            error: (error as Error).message,
          },
        },
      );
      this.logger.error(`Fallo el reembolso para orden ${orderId}: ${(error as Error).message}`);
      throw new ConflictException('No se pudo procesar el reembolso en Stripe');
    }
  }

  async reconcileOrderPayment(actor: Actor, orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    paymentStatus: string;
    checkoutSessionId: string | null;
    checkoutSessionStatus: string | null;
  }> {
    const order = await this.ordersService.findOrder(orderId, actor);
    if (order.status === OrderStatus.PAID || order.paymentStatus === 'paid') {
      return {
        orderId: order.id,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        checkoutSessionId: null,
        checkoutSessionStatus: null,
      };
    }

    const checkoutSessionId = await this.findLatestCheckoutSessionId(order.id);
    if (!checkoutSessionId) {
      throw new NotFoundException('No se encontro una sesion de checkout para esta orden');
    }

    const confirmation = await this.confirmCheckoutSession(actor, checkoutSessionId);
    return {
      ...confirmation,
      checkoutSessionId,
    };
  }

  private getStripeClient(): Stripe {
    if (this.stripeClient) {
      return this.stripeClient;
    }

    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new NotFoundException('STRIPE_SECRET_KEY no esta configurado');
    }

    this.stripeClient = new Stripe(stripeSecretKey, {
      apiVersion: '2025-08-27.basil',
    });

    return this.stripeClient;
  }

  private async processWebhookEvent(payload: {
    orderId: string;
    event: Stripe.Event;
    status: string;
    paymentReference: string;
  }): Promise<void> {
    const { orderId, event, status, paymentReference } = payload;

    const order = await this.ordersService.findOrder(orderId, {
      userId: 'system',
      role: UserRole.PLATFORM_SUPERADMIN,
      tenantId: null,
    });

    const acquired = await this.acquireWebhookEventLock(order, event);
    if (!acquired) {
      this.logger.debug(`Evento webhook de Stripe ya procesado o en progreso: ${event.id}`);
      return;
    }

    try {
      if (status === 'paid') {
        await this.ordersService.markOrderAsPaid(order.id, 'stripe', paymentReference);
        await this.tryIssueBillingDocument(order.id, `webhook:${event.type}`);
      } else if (status === 'failed') {
        await this.ordersService.cancelOrderForPaymentFailure(
          order.id,
          'payment_failure',
          `Payment provider reported failure via ${event.type}`,
        );
      }

      await this.finalizeWebhookEvent(event, status);
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof BadRequestException) {
        this.logger.warn(
          `Stripe webhook event ${event.id} ignored due business rule: ${(error as Error).message}`,
        );
        await this.finalizeWebhookEvent(event, 'ignored');
        return;
      }

      await this.finalizeWebhookEvent(event, 'failed_processing');
      throw error;
    }
  }

  private async processRefundWebhookEvent(refund: Stripe.Refund, eventType: string): Promise<void> {
    const stripe = this.getStripeClient();
    const order = await this.findOrderForRefundEvent(refund, stripe);
    if (!order) {
      this.logger.warn(`No se pudo vincular refund ${refund.id} a una orden`);
      return;
    }

    const savedRefund = await this.upsertRefundFromStripe(order, refund, eventType);
    await this.syncOrderPaymentStatusAfterRefund(order.id);
    if (savedRefund.status === 'succeeded') {
      await this.tryIssueCreditNoteForRefund(savedRefund, `webhook:${eventType}`);
    }
  }

  private async findOrderForRefundEvent(refund: Stripe.Refund, stripe: Stripe): Promise<Order | null> {
    const ordersRepository = this.dataSource.getRepository(Order);
    const metadataOrderId = this.getMetadataValue(refund.metadata, 'orderId');
    if (metadataOrderId) {
      const orderByMetadata = await ordersRepository.findOne({ where: { id: metadataOrderId } });
      if (orderByMetadata) {
        return orderByMetadata;
      }
    }

    const paymentIntentId = await this.extractPaymentIntentIdFromRefund(refund, stripe);
    if (!paymentIntentId) {
      return null;
    }

    return ordersRepository.findOne({
      where: {
        paymentProvider: 'stripe',
        paymentReference: paymentIntentId,
      },
    });
  }

  private async extractPaymentIntentIdFromRefund(refund: Stripe.Refund, stripe: Stripe): Promise<string | null> {
    const paymentIntent =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id ?? null;
    if (paymentIntent) {
      return paymentIntent;
    }

    if (typeof refund.charge === 'string' && refund.charge) {
      const charge = await stripe.charges.retrieve(refund.charge, {
        expand: ['payment_intent'],
      });

      if (typeof charge.payment_intent === 'string') {
        return charge.payment_intent;
      }

      if (charge.payment_intent?.id) {
        return charge.payment_intent.id;
      }
    }

    return null;
  }

  private async upsertRefundFromStripe(order: Order, refund: Stripe.Refund, eventType: string): Promise<PaymentRefund> {
    const metadataRefundId = this.getMetadataValue(refund.metadata, 'refundId');
    const metadataClientRequestId = this.getMetadataValue(refund.metadata, 'clientRequestId');
    const metadataRequestedByUserId = this.getMetadataValue(refund.metadata, 'requestedByUserId');

    const nextValues = {
      orderId: order.id,
      tenantId: order.tenantId,
      provider: 'stripe',
      status: refund.status ?? 'pending',
      externalId: refund.id,
      amount: this.toMoney(this.fromMinorUnits(refund.amount ?? 0)),
      currency: (refund.currency ?? order.currency).toUpperCase(),
      reason: refund.reason ?? null,
      requestedByUserId: metadataRequestedByUserId ?? null,
      clientRequestId: metadataClientRequestId ?? null,
      metadata: {
        eventType,
        stripeRefund: refund,
      } as Record<string, unknown>,
    };

    if (metadataRefundId) {
      const existingById = await this.refundsRepository.findOne({
        where: {
          id: metadataRefundId,
          orderId: order.id,
        },
      });
      if (existingById) {
        return this.refundsRepository.save({
          ...existingById,
          ...nextValues,
        });
      }
    }

    const existingByExternalId = await this.refundsRepository.findOne({
      where: {
        provider: 'stripe',
        externalId: refund.id,
      },
    });
    if (existingByExternalId) {
      return this.refundsRepository.save({
        ...existingByExternalId,
        ...nextValues,
      });
    }

    if (metadataClientRequestId) {
      const existingByClientRequestId = await this.refundsRepository.findOne({
        where: {
          orderId: order.id,
          clientRequestId: metadataClientRequestId,
        },
      });
      if (existingByClientRequestId) {
        return this.refundsRepository.save({
          ...existingByClientRequestId,
          ...nextValues,
        });
      }
    }

    return this.refundsRepository.save(this.refundsRepository.create(nextValues));
  }

  private async upsertCheckoutSessionTransaction(
    order: Order,
    session: Stripe.Checkout.Session,
    status: string,
    eventType: string,
  ): Promise<void> {
    const metadata = {
      checkoutSessionId: session.id,
      paymentStatus: session.payment_status,
      checkoutSessionStatus: session.status ?? null,
      customerEmail: session.customer_email ?? null,
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    };

    await this.upsertTransactionByExternalId({
      orderId: order.id,
      tenantId: order.tenantId,
      provider: 'stripe',
      status,
      eventType,
      externalId: session.id,
      amount: order.total,
      currency: order.currency,
      metadata,
    });
  }

  private async findLatestCheckoutSessionId(orderId: string): Promise<string | null> {
    const transaction = await this.paymentsRepository
      .createQueryBuilder('payment')
      .where('payment.orderId = :orderId', { orderId })
      .andWhere("payment.provider = 'stripe'")
      .andWhere("payment.externalId LIKE 'cs_%'")
      .orderBy('payment.createdAt', 'DESC')
      .getOne();

    return transaction?.externalId ?? null;
  }

  private async acquireWebhookEventLock(order: Order, event: Stripe.Event): Promise<boolean> {
    const insertResult = await this.paymentsRepository
      .createQueryBuilder()
      .insert()
      .into(PaymentTransaction)
      .values({
        orderId: order.id,
        tenantId: order.tenantId,
        provider: 'stripe',
        status: 'processing',
        eventType: event.type,
        externalId: event.id,
        amount: order.total,
        currency: order.currency,
        metadata: event.data.object as unknown as any,
      })
      .onConflict('("provider","externalId") DO NOTHING')
      .returning('id')
      .execute();

    if (Array.isArray(insertResult.raw) && insertResult.raw.length > 0) {
      return true;
    }

    const existing = await this.paymentsRepository.findOne({
      where: {
        provider: 'stripe',
        externalId: event.id,
      },
    });

    if (!existing) {
      return false;
    }

    if (existing.status !== 'failed_processing') {
      return false;
    }

    const retryResult = await this.paymentsRepository
      .createQueryBuilder()
      .update(PaymentTransaction)
      .set({
        status: 'processing',
        eventType: event.type,
        metadata: event.data.object as unknown as any,
      })
      .where('id = :id', { id: existing.id })
      .andWhere('status = :status', { status: 'failed_processing' })
      .execute();

    return (retryResult.affected ?? 0) > 0;
  }

  private async finalizeWebhookEvent(event: Stripe.Event, status: string): Promise<void> {
    await this.paymentsRepository
      .createQueryBuilder()
      .update(PaymentTransaction)
      .set({
        status,
        eventType: event.type,
        metadata: event.data.object as unknown as any,
      })
      .where('provider = :provider', { provider: 'stripe' })
      .andWhere('"externalId" = :externalId', { externalId: event.id })
      .execute();
  }

  private async upsertTransactionByExternalId(payload: {
    orderId: string;
    tenantId: string;
    provider: string;
    status: string;
    eventType: string;
    externalId: string;
    amount: string;
    currency: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.paymentsRepository
      .createQueryBuilder()
      .insert()
      .into(PaymentTransaction)
      .values(payload as any)
      .onConflict(
        `("provider","externalId") DO UPDATE SET
          "status" = EXCLUDED."status",
          "eventType" = EXCLUDED."eventType",
          "metadata" = EXCLUDED."metadata",
          "amount" = EXCLUDED."amount",
          "currency" = EXCLUDED."currency",
          "updatedAt" = NOW()`,
      )
      .execute();
  }

  private async syncOrderPaymentStatusAfterRefund(orderId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const transactionalOrdersRepository = manager.getRepository(Order);
      const transactionalRefundsRepository = manager.getRepository(PaymentRefund);

      const order = await transactionalOrdersRepository
        .createQueryBuilder('ord')
        .setLock('pessimistic_write')
        .where('ord.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        return;
      }

      const succeededRefunds = await transactionalRefundsRepository.find({
        where: {
          orderId: order.id,
          status: 'succeeded',
        },
      });

      const refundedAmount = succeededRefunds.reduce((acc, entry) => acc + Number(entry.amount), 0);
      const totalAmount = Number(order.total);

      let nextPaymentStatus = 'paid';
      if (refundedAmount >= totalAmount && totalAmount > 0) {
        nextPaymentStatus = 'refunded';
      } else if (refundedAmount > 0) {
        nextPaymentStatus = 'partially_refunded';
      }

      if (order.paymentStatus !== nextPaymentStatus) {
        order.paymentStatus = nextPaymentStatus;
        await transactionalOrdersRepository.save(order);
      }
    });
  }

  private async tryIssueBillingDocument(orderId: string, trigger: string): Promise<void> {
    try {
      const enqueued = await this.jobsQueueService.enqueueIssueOrderDocument({
        orderId,
        trigger,
      });
      if (enqueued) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar emision de comprobante para orden ${orderId}: ${(error as Error).message}`,
      );
    }

    try {
      const document = await this.billingService.issueDocumentForPaidOrder(orderId, trigger);
      if (!document) {
        this.logger.warn(
          `No se emitio comprobante para orden ${orderId}: revisa configuracion de facturacion del tenant`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir comprobante para orden ${orderId}: ${(error as Error).message}`,
      );
    }
  }

  private async tryIssueCreditNoteForRefund(refund: PaymentRefund, trigger: string): Promise<void> {
    try {
      const enqueued = await this.jobsQueueService.enqueueIssueCreditNote({
        tenantId: refund.tenantId,
        orderId: refund.orderId,
        refundId: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        reason: refund.reason,
        trigger,
      });
      if (enqueued) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo encolar nota de credito para refund ${refund.id}: ${(error as Error).message}`,
      );
    }

    try {
      await this.billingService.issueCreditNoteForRefund({
        tenantId: refund.tenantId,
        orderId: refund.orderId,
        refundId: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        reason: refund.reason,
        trigger,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo emitir nota de credito para refund ${refund.id}: ${(error as Error).message}`,
      );
    }
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }

  private toMinorUnits(value: number): number {
    return Math.max(Math.round(value * 100), 0);
  }

  private fromMinorUnits(value: number): number {
    return Math.max(value, 0) / 100;
  }

  private getMetadataValue(metadata: Stripe.Metadata | null | undefined, key: string): string | null {
    const raw = metadata?.[key];
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }
}
