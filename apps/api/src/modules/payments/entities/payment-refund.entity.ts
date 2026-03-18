import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'payment_refunds' })
@Unique('ux_payment_refunds_provider_external', ['provider', 'externalId'])
@Unique('ux_payment_refunds_order_client_request', ['orderId', 'clientRequestId'])
export class PaymentRefund {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount!: string;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  requestedByUserId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  clientRequestId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
