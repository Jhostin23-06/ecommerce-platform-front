import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatusHistory } from './order-status-history.entity';

export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum OrderLifecycleStatus {
  PENDING = 'pending',
  PAID = 'paid',
  PREPARING = 'preparing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum FulfillmentType {
  DELIVERY = 'delivery',
  PICKUP = 'pickup',
}

export enum FulfillmentStatus {
  PENDING = 'pending',
  PREPARING = 'preparing',
  READY_FOR_DISPATCH = 'ready_for_dispatch',
  ON_THE_WAY = 'on_the_way',
  READY_FOR_PICKUP = 'ready_for_pickup',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export type DeliveryAddress = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  district: string;
  city: string;
  reference?: string | null;
};

export type PickupDetails = {
  pointId: string;
  pointName: string;
  pointAddress?: string | null;
  windowLabel: string;
  scheduledAt?: string | null;
};

export type BillingDetails = {
  documentType: 'receipt' | 'invoice';
  customerDocumentType: string;
  customerDocumentNumber: string;
  customerName: string;
  customerEmail?: string | null;
  customerAddress?: string | null;
};

export type BillingDocumentSnapshotStatus =
  | 'issued'
  | 'failed'
  | 'missing_configuration'
  | 'pending'
  | null;

@Entity({ name: 'orders' })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING_PAYMENT })
  status!: OrderStatus;

  @Column({ type: 'varchar', length: 30, default: OrderLifecycleStatus.PENDING })
  lifecycleStatus!: OrderLifecycleStatus;

  @Column({ type: 'varchar', length: 30, default: 'unpaid' })
  paymentStatus!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  paymentProvider!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymentReference!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  couponCode!: string | null;

  @Column({ type: 'enum', enum: FulfillmentType, default: FulfillmentType.DELIVERY })
  fulfillmentType!: FulfillmentType;

  @Column({ type: 'enum', enum: FulfillmentStatus, default: FulfillmentStatus.PENDING })
  fulfillmentStatus!: FulfillmentStatus;

  @Column({ type: 'jsonb', nullable: true })
  deliveryAddress!: DeliveryAddress | null;

  @Column({ type: 'jsonb', nullable: true })
  pickupDetails!: PickupDetails | null;

  @Column({ type: 'uuid', nullable: true })
  deliveryZoneId!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  deliveryZoneName!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  deliveryWindow!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  assignedCourierName!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  assignedCourierPhone!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  fulfillmentNotes!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  shippingFee!: string;

  @Column({ type: 'timestamptz', nullable: true })
  estimatedFulfillmentAt!: Date | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountTotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total!: string;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'jsonb', nullable: true })
  billingDetails!: BillingDetails | null;

  // Computed at runtime for UI diagnostics. Not persisted in DB.
  billingDocumentStatus?: BillingDocumentSnapshotStatus;
  billingDocumentMessage?: string | null;
  billingDocumentNumber?: string | null;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items!: OrderItem[];

  @OneToMany(() => OrderStatusHistory, (entry) => entry.order, {
    cascade: false,
    eager: true,
  })
  statusHistory!: OrderStatusHistory[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
