import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum BillingProvider {
  DEMO = 'demo',
  NUBEFACT = 'nubefact',
}

export enum BillingEnvironment {
  DEMO = 'demo',
  PRODUCTION = 'production',
}

@Entity({ name: 'tenant_billing_settings' })
@Index('ux_tenant_billing_settings_tenant_id', ['tenantId'], { unique: true })
export class BillingSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30, default: BillingProvider.DEMO })
  provider!: BillingProvider;

  @Column({ type: 'varchar', length: 20, default: BillingEnvironment.DEMO })
  environment!: BillingEnvironment;

  @Column({ type: 'boolean', default: false })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 11, nullable: true })
  issuerRuc!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  issuerBusinessName!: string | null;

  @Column({ type: 'varchar', length: 220, nullable: true })
  issuerAddress!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'F001' })
  invoiceSeries!: string;

  @Column({ type: 'varchar', length: 10, default: 'B001' })
  receiptSeries!: string;

  @Column({ type: 'varchar', length: 10, default: 'FC01' })
  creditNoteSeries!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  apiBaseUrl!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  apiToken!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  extraConfig!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
