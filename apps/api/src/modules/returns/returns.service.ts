import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import { OrderStatusHistory } from '../orders/order-status-history.entity';
import { FulfillmentStatus, Order, OrderLifecycleStatus, OrderStatus } from '../orders/order.entity';
import { OrdersService } from '../orders/orders.service';
import { CreateRefundDto } from '../payments/dto/create-refund.dto';
import { PaymentsService } from '../payments/payments.service';
import { CreateOrderReturnDto } from './dto/create-order-return.dto';
import { ListTenantReturnsDto } from './dto/list-tenant-returns.dto';
import { UpdateOrderReturnStatusDto } from './dto/update-order-return-status.dto';
import { OrderReturn, OrderReturnStatus } from './order-return.entity';
import { ReturnEmailService } from './return-email.service';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
  email: string;
};

@Injectable()
export class ReturnsService {
  private static readonly DAY_IN_MS = 24 * 60 * 60 * 1000;
  private static readonly ACTIVE_RETURN_STATUSES: OrderReturnStatus[] = [
    OrderReturnStatus.REQUESTED,
    OrderReturnStatus.APPROVED,
    OrderReturnStatus.PICKUP_PENDING,
    OrderReturnStatus.PICKUP_ASSIGNED,
    OrderReturnStatus.PICKED_UP,
    OrderReturnStatus.RECEIVED,
  ];
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    @InjectRepository(OrderReturn)
    private readonly returnsRepository: Repository<OrderReturn>,
    @InjectRepository(OrderStatusHistory)
    private readonly orderStatusHistoryRepository: Repository<OrderStatusHistory>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    private readonly returnEmailService: ReturnEmailService,
  ) {}

  async createReturn(actor: Actor, createOrderReturnDto: CreateOrderReturnDto): Promise<OrderReturn> {
    if (!this.isReturnPolicyEnabled()) {
      throw new ConflictException('Las devoluciones estan deshabilitadas temporalmente');
    }

    const order = await this.ordersService.findOrder(createOrderReturnDto.orderId, actor);

    if (order.status !== OrderStatus.PAID) {
      throw new ConflictException('Solo puedes solicitar devolucion para ordenes pagadas');
    }
    if (order.paymentStatus === 'refunded') {
      throw new ConflictException('La orden ya fue reembolsada completamente');
    }
    if (this.requiresCompletedFulfillment() && order.fulfillmentStatus !== FulfillmentStatus.COMPLETED) {
      throw new ConflictException('Solo puedes solicitar devolucion para pedidos completados');
    }

    this.assertReturnWindow(order);

    const existingOpenReturn = await this.returnsRepository.findOne({
      where: {
        orderId: order.id,
        status: In(ReturnsService.ACTIVE_RETURN_STATUSES),
      },
    });
    if (existingOpenReturn) {
      throw new ConflictException('Ya existe una devolucion activa para esta orden');
    }

    if (createOrderReturnDto.requestedAmount !== undefined && createOrderReturnDto.requestedAmount > Number(order.total)) {
      throw new BadRequestException('El monto solicitado supera el total de la orden');
    }

    const created = this.returnsRepository.create({
      orderId: order.id,
      tenantId: order.tenantId,
      userId: order.userId,
      status: OrderReturnStatus.REQUESTED,
      reason: createOrderReturnDto.reason.trim(),
      adminNote: null,
      requestedAmount:
        createOrderReturnDto.requestedAmount !== undefined
          ? this.toMoney(createOrderReturnDto.requestedAmount)
          : null,
      refundAmount: null,
      currency: order.currency,
      refundReference: null,
      pickupCourierName: null,
      pickupCourierPhone: null,
      pickupScheduledAt: null,
      pickupCompletedAt: null,
    });

    const persistedReturn = await this.returnsRepository.save(created);
    await this.appendReturnHistoryEntry(order, actor.userId, 'Devolucion solicitada', {
      returnId: persistedReturn.id,
      returnStatus: persistedReturn.status,
      requestedAmount: persistedReturn.requestedAmount,
      currency: persistedReturn.currency,
    });
    await this.notifyReturnStatusChanged(persistedReturn);

    return persistedReturn;
  }

  async listMyReturns(actor: Actor): Promise<OrderReturn[]> {
    return this.returnsRepository.find({
      where: { userId: actor.userId },
      order: { createdAt: 'DESC' },
    });
  }

  async listTenantReturns(query: ListTenantReturnsDto, actor: Actor): Promise<OrderReturn[]> {
    const targetTenantId = this.resolveTargetTenantId(query, actor);
    if (!targetTenantId) {
      return this.returnsRepository.find({
        order: { createdAt: 'DESC' },
      });
    }

    return this.returnsRepository.find({
      where: { tenantId: targetTenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(
    returnId: string,
    updateOrderReturnStatusDto: UpdateOrderReturnStatusDto,
    actor: Actor,
  ): Promise<OrderReturn> {
    const orderReturn = await this.returnsRepository.findOne({ where: { id: returnId } });
    if (!orderReturn) {
      throw new NotFoundException('Solicitud de devolucion no encontrada');
    }

    this.assertTenantAccess(orderReturn.tenantId, actor);
    const order = await this.ordersService.findOrder(orderReturn.orderId, actor);

    const nextStatus = updateOrderReturnStatusDto.status;
    const previousStatus = orderReturn.status;

    if (previousStatus === nextStatus) {
      return orderReturn;
    }

    if (previousStatus === OrderReturnStatus.REJECTED || previousStatus === OrderReturnStatus.REFUNDED) {
      throw new ConflictException('La devolucion ya esta cerrada');
    }

    if (!this.isAllowedStatusTransition(previousStatus, nextStatus)) {
      throw new ConflictException('Transicion invalida para la devolucion');
    }

    if (nextStatus === OrderReturnStatus.REFUNDED) {
      return this.processRefundTransition(orderReturn, updateOrderReturnStatusDto, actor, order);
    }

    if (typeof updateOrderReturnStatusDto.adminNote === 'string') {
      orderReturn.adminNote = updateOrderReturnStatusDto.adminNote.trim() || null;
    }

    this.applyPickupUpdates(orderReturn, updateOrderReturnStatusDto, nextStatus);
    orderReturn.status = nextStatus;
    const savedReturn = await this.returnsRepository.save(orderReturn);

    await this.appendReturnHistoryEntry(order, actor.userId, this.returnStatusToNote(savedReturn.status), {
      returnId: savedReturn.id,
      previousStatus,
      returnStatus: savedReturn.status,
      adminNote: savedReturn.adminNote,
      pickupCourierName: savedReturn.pickupCourierName,
      pickupCourierPhone: savedReturn.pickupCourierPhone,
      pickupScheduledAt: savedReturn.pickupScheduledAt?.toISOString() ?? null,
      pickupCompletedAt: savedReturn.pickupCompletedAt?.toISOString() ?? null,
    });
    await this.notifyReturnStatusChanged(savedReturn);

    return savedReturn;
  }

  private resolveTargetTenantId(query: ListTenantReturnsDto, actor: Actor): string | null {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return query.tenantId ?? null;
    }

    if (!actor.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }

    if (query.tenantId && query.tenantId !== actor.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }

    return actor.tenantId;
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

  private isReturnPolicyEnabled(): boolean {
    return this.parseBooleanEnv('RETURN_POLICY_ENABLED', true);
  }

  private requiresCompletedFulfillment(): boolean {
    return this.parseBooleanEnv('RETURN_POLICY_REQUIRE_COMPLETED_FULFILLMENT', true);
  }

  private getReturnWindowDays(): number {
    const rawValue = this.configService.get<string>('RETURN_POLICY_WINDOW_DAYS');
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return 7;
    }
    return Math.floor(parsedValue);
  }

  private isPickupRequiredForReturn(): boolean {
    return this.parseBooleanEnv('RETURN_POLICY_PICKUP_REQUIRED', true);
  }

  private isAllowedStatusTransition(current: OrderReturnStatus, next: OrderReturnStatus): boolean {
    const allowedTransitions: Record<OrderReturnStatus, OrderReturnStatus[]> = {
      [OrderReturnStatus.REQUESTED]: [OrderReturnStatus.APPROVED, OrderReturnStatus.REJECTED],
      [OrderReturnStatus.APPROVED]: [OrderReturnStatus.PICKUP_PENDING, OrderReturnStatus.REJECTED, OrderReturnStatus.REFUNDED],
      [OrderReturnStatus.PICKUP_PENDING]: [
        OrderReturnStatus.PICKUP_ASSIGNED,
        OrderReturnStatus.RECEIVED,
        OrderReturnStatus.REJECTED,
      ],
      [OrderReturnStatus.PICKUP_ASSIGNED]: [
        OrderReturnStatus.PICKED_UP,
        OrderReturnStatus.PICKUP_PENDING,
        OrderReturnStatus.REJECTED,
      ],
      [OrderReturnStatus.PICKED_UP]: [OrderReturnStatus.RECEIVED, OrderReturnStatus.REJECTED],
      [OrderReturnStatus.RECEIVED]: [OrderReturnStatus.REFUNDED, OrderReturnStatus.REJECTED],
      [OrderReturnStatus.REJECTED]: [],
      [OrderReturnStatus.REFUNDED]: [],
    };

    return allowedTransitions[current]?.includes(next) ?? false;
  }

  private async processRefundTransition(
    orderReturn: OrderReturn,
    dto: UpdateOrderReturnStatusDto,
    actor: Actor,
    order: Order,
  ): Promise<OrderReturn> {
    if (this.isPickupRequiredForReturn() && orderReturn.status !== OrderReturnStatus.RECEIVED) {
      throw new ConflictException('Debes completar el flujo de recojo antes de reembolsar');
    }

    const refundDto: CreateRefundDto = {
      amount: dto.refundAmount ?? (orderReturn.requestedAmount ? Number(orderReturn.requestedAmount) : undefined),
      reason: dto.adminNote?.trim() || orderReturn.reason,
      clientRequestId: dto.clientRequestId?.trim() || `return-${orderReturn.id}-refund`,
    };

    const refundResult = await this.paymentsService.refundOrder(
      {
        userId: actor.userId,
        role: actor.role,
        tenantId: actor.tenantId,
        email: actor.email,
      },
      orderReturn.orderId,
      refundDto,
    );

    const previousStatus = orderReturn.status;
    orderReturn.status = OrderReturnStatus.REFUNDED;
    if (typeof dto.adminNote === 'string') {
      orderReturn.adminNote = dto.adminNote.trim() || null;
    }
    orderReturn.refundAmount = refundResult.amount;
    orderReturn.refundReference = refundResult.externalId;
    if (!orderReturn.pickupCompletedAt) {
      orderReturn.pickupCompletedAt = new Date();
    }

    const savedReturn = await this.returnsRepository.save(orderReturn);
    await this.appendReturnHistoryEntry(order, actor.userId, this.returnStatusToNote(savedReturn.status), {
      returnId: savedReturn.id,
      previousStatus,
      returnStatus: savedReturn.status,
      refundAmount: savedReturn.refundAmount,
      refundReference: savedReturn.refundReference,
      paymentStatus: refundResult.status,
    });
    await this.notifyReturnStatusChanged(savedReturn);

    return savedReturn;
  }

  private applyPickupUpdates(
    orderReturn: OrderReturn,
    dto: UpdateOrderReturnStatusDto,
    nextStatus: OrderReturnStatus,
  ): void {
    if (nextStatus === OrderReturnStatus.PICKUP_ASSIGNED) {
      const pickupCourierName = dto.pickupCourierName?.trim() || orderReturn.pickupCourierName;
      const pickupCourierPhone = dto.pickupCourierPhone?.trim() || orderReturn.pickupCourierPhone;
      if (!pickupCourierName || !pickupCourierPhone) {
        throw new BadRequestException('Debes indicar nombre y telefono del repartidor para asignar el recojo');
      }
      const pickupScheduledAt = this.parseDateInput(
        dto.pickupScheduledAt,
        'pickupScheduledAt',
        orderReturn.pickupScheduledAt,
      );
      if (!pickupScheduledAt) {
        throw new BadRequestException('Debes indicar fecha y hora de recojo para asignar el recojo');
      }
      orderReturn.pickupCourierName = pickupCourierName;
      orderReturn.pickupCourierPhone = pickupCourierPhone;
      orderReturn.pickupScheduledAt = pickupScheduledAt;
      return;
    }

    if (nextStatus === OrderReturnStatus.PICKED_UP) {
      orderReturn.pickupCompletedAt = this.parseDateInput(dto.pickupCompletedAt, 'pickupCompletedAt', new Date());
      return;
    }

    if (nextStatus === OrderReturnStatus.RECEIVED && !orderReturn.pickupCompletedAt) {
      orderReturn.pickupCompletedAt = this.parseDateInput(dto.pickupCompletedAt, 'pickupCompletedAt', new Date());
    }
  }

  private parseDateInput(input: string | undefined, fieldName: string, fallback: Date | null): Date | null {
    if (typeof input !== 'string') {
      return fallback;
    }

    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Fecha invalida para ${fieldName}`);
    }
    return parsed;
  }

  private returnStatusToNote(status: OrderReturnStatus): string {
    if (status === OrderReturnStatus.APPROVED) {
      return 'Devolucion aprobada';
    }
    if (status === OrderReturnStatus.PICKUP_PENDING) {
      return 'Recojo de devolucion pendiente';
    }
    if (status === OrderReturnStatus.PICKUP_ASSIGNED) {
      return 'Recojo de devolucion asignado';
    }
    if (status === OrderReturnStatus.PICKED_UP) {
      return 'Producto recogido para devolucion';
    }
    if (status === OrderReturnStatus.RECEIVED) {
      return 'Producto recibido en almacen';
    }
    if (status === OrderReturnStatus.REJECTED) {
      return 'Devolucion rechazada';
    }
    if (status === OrderReturnStatus.REFUNDED) {
      return 'Devolucion reembolsada';
    }
    return 'Devolucion actualizada';
  }

  private async notifyReturnStatusChanged(orderReturn: OrderReturn): Promise<void> {
    if (!this.returnEmailService.isEnabled()) {
      return;
    }

    try {
      const contact = await this.loadReturnCustomerContact(orderReturn.userId);
      if (!contact) {
        return;
      }

      await this.returnEmailService.sendReturnStatusChangedEmail({
        toEmail: contact.email,
        fullName: contact.fullName,
        orderId: orderReturn.orderId,
        returnId: orderReturn.id,
        status: orderReturn.status,
        reason: orderReturn.reason,
        adminNote: orderReturn.adminNote,
        requestedAmount: orderReturn.requestedAmount,
        refundAmount: orderReturn.refundAmount,
        currency: orderReturn.currency,
        pickupCourierName: orderReturn.pickupCourierName,
        pickupCourierPhone: orderReturn.pickupCourierPhone,
        pickupScheduledAt: orderReturn.pickupScheduledAt,
        pickupCompletedAt: orderReturn.pickupCompletedAt,
      });
    } catch (error) {
      this.logger.warn(
        `Fallo el correo de devolucion ${orderReturn.id} para la orden ${orderReturn.orderId}: ${(error as Error).message}`,
      );
    }
  }

  private async loadReturnCustomerContact(userId: string): Promise<{ email: string; fullName: string } | null> {
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

  private parseBooleanEnv(key: string, defaultValue: boolean): boolean {
    const rawValue = this.configService.get<string>(key);
    if (typeof rawValue !== 'string') {
      return defaultValue;
    }

    const normalized = rawValue.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    return defaultValue;
  }

  private assertReturnWindow(order: Pick<Order, 'createdAt' | 'updatedAt' | 'statusHistory'>): void {
    const windowDays = this.getReturnWindowDays();
    const referenceDate = this.resolveReturnReferenceDate(order);
    const deadline = new Date(referenceDate.getTime() + windowDays * ReturnsService.DAY_IN_MS);
    if (Date.now() <= deadline.getTime()) {
      return;
    }

    throw new ConflictException(
      `La devolucion supera la ventana permitida de ${windowDays} dias (vence: ${deadline.toISOString()})`,
    );
  }

  private resolveReturnReferenceDate(order: Pick<Order, 'createdAt' | 'updatedAt' | 'statusHistory'>): Date {
    const history = Array.isArray(order.statusHistory) ? [...order.statusHistory] : [];
    history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const historyEntry = history[index];
      if (historyEntry.nextStatus === OrderLifecycleStatus.DELIVERED) {
        return new Date(historyEntry.createdAt);
      }
    }

    if (order.updatedAt) {
      return new Date(order.updatedAt);
    }
    return new Date(order.createdAt);
  }

  private async appendReturnHistoryEntry(
    order: Pick<Order, 'id' | 'lifecycleStatus'>,
    changedByUserId: string | null,
    note: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.orderStatusHistoryRepository.save(
      this.orderStatusHistoryRepository.create({
        orderId: order.id,
        previousStatus: order.lifecycleStatus,
        nextStatus: order.lifecycleStatus ?? OrderLifecycleStatus.PENDING,
        changedByUserId,
        source: 'returns',
        note,
        metadata: metadata ?? null,
      }),
    );
  }
}
