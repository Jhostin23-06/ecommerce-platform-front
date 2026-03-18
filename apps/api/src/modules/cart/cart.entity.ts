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
import { CartItem } from './cart-item.entity';

export enum CartStatus {
  ACTIVE = 'active',
  ORDERED = 'ordered',
  ABANDONED = 'abandoned',
}

@Entity({ name: 'carts' })
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: CartStatus, default: CartStatus.ACTIVE })
  status!: CartStatus;

  @Column({ type: 'varchar', length: 3, default: 'PEN' })
  currency!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountTotal!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  total!: string;

  @OneToMany(() => CartItem, (item) => item.cart, {
    cascade: true,
    eager: true,
  })
  items!: CartItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
