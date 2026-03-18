import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export enum CouponType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

export enum CouponScope {
  ORDER = 'order',
  VOLUME = 'volume',
  BUNDLE = 'bundle',
}

export type CouponRules = {
  minQuantity?: number | null;
  productIds?: string[];
  categoryIds?: string[];
  requiredProductIds?: string[];
  requiredCategoryIds?: string[];
};

@Entity({ name: 'coupons' })
@Unique(['tenantId', 'code'])
export class Coupon {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'enum', enum: CouponType })
  type!: CouponType;

  @Column({ type: 'enum', enum: CouponScope, default: CouponScope.ORDER })
  scope!: CouponScope;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  value!: string;

  @Column({ type: 'int', default: 0 })
  usageCount!: number;

  @Column({ type: 'int', nullable: true })
  maxUsage!: number | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  rules!: CouponRules | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
