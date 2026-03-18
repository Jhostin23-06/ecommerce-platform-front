import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'payment_transactions' })
@Unique('ux_payment_transactions_provider_external', ['provider', 'externalId'])
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  eventType!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount!: string;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
