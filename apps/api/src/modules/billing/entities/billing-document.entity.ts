import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BillingEnvironment, BillingProvider } from './billing-settings.entity';

export enum BillingDocumentKind {
  RECEIPT = 'receipt',
  INVOICE = 'invoice',
  CREDIT_NOTE = 'credit_note',
}

export enum BillingDocumentStatus {
  ISSUED = 'issued',
  FAILED = 'failed',
}

@Entity({ name: 'billing_documents' })
@Index('ix_billing_documents_tenant_created_desc', ['tenantId', 'createdAt'])
@Index('ix_billing_documents_order_created_desc', ['orderId', 'createdAt'])
@Index('ux_billing_documents_refund_id', ['refundId'], { unique: true })
export class BillingDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  orderId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  refundId!: string | null;

  @Column({ type: 'varchar', length: 30 })
  provider!: BillingProvider;

  @Column({ type: 'varchar', length: 20 })
  environment!: BillingEnvironment;

  @Column({ type: 'varchar', length: 20 })
  kind!: BillingDocumentKind;

  @Column({ type: 'varchar', length: 20, default: BillingDocumentStatus.ISSUED })
  status!: BillingDocumentStatus;

  @Column({ type: 'varchar', length: 10 })
  series!: string;

  @Column({ type: 'int' })
  number!: number;

  @Column({ type: 'varchar', length: 30 })
  documentNumber!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalId!: string | null;

  @Column({ type: 'timestamptz' })
  issueDate!: Date;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxTotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total!: string;

  @Column({ type: 'varchar', length: 160 })
  customerName!: string;

  @Column({ type: 'varchar', length: 20 })
  customerDocumentType!: string;

  @Column({ type: 'varchar', length: 40 })
  customerDocumentNumber!: string;

  @Column({ type: 'jsonb', nullable: true })
  requestPayload!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  providerResponse!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
