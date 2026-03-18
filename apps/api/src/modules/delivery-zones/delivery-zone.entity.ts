import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'delivery_zones' })
export class DeliveryZone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  districts!: string[];

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  fee!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  minOrderAmount!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  freeShippingFrom!: string | null;

  @Column({ type: 'int', default: 180 })
  etaMinutes!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
