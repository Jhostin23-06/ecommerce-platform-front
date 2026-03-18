import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { Order } from './order.entity';

@Entity({ name: 'order_items' })
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column({ type: 'uuid', nullable: true })
  productVariantId!: string | null;

  @ManyToOne(() => ProductVariant, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productVariantId' })
  productVariant!: ProductVariant | null;

  @Column({ type: 'varchar', length: 160 })
  productName!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  sku!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  lineTotal!: string;
}
