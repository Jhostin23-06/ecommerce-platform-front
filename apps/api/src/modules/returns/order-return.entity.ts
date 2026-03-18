import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from '../orders/order.entity';

export enum OrderReturnStatus {
  REQUESTED = 'requested',
  APPROVED = 'approved',
  PICKUP_PENDING = 'pickup_pending',
  PICKUP_ASSIGNED = 'pickup_assigned',
  PICKED_UP = 'picked_up',
  RECEIVED = 'received',
  REJECTED = 'rejected',
  REFUNDED = 'refunded',
}

@Entity({ name: 'order_returns' })
export class OrderReturn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 30, default: OrderReturnStatus.REQUESTED })
  status!: OrderReturnStatus;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  adminNote!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  requestedAmount!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  refundAmount!: string | null;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  refundReference!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  pickupCourierName!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  pickupCourierPhone!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pickupScheduledAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pickupCompletedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
