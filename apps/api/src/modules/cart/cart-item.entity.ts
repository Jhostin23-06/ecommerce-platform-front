import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from '../catalog/entities/product.entity';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { Cart } from './cart.entity';

@Entity({ name: 'cart_items' })
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cartId!: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' })
  cart!: Cart;

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
  productNameSnapshot!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  skuSnapshot!: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  productImageUrlSnapshot!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  unitPrice!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  lineTotal!: string;
}
