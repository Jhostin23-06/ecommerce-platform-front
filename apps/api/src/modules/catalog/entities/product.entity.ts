import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from './category.entity';
import { ProductImage } from './product-image.entity';
import { ProductReview } from './product-review.entity';
import { ProductVariant } from './product-variant.entity';
import { WishlistItem } from './wishlist-item.entity';

@Entity({ name: 'products' })
@Unique(['tenantId', 'slug'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, (category) => category.products, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category!: Category | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 160 })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  price!: string;

  @Column({ type: 'int', default: 0 })
  stock!: number;

  @Column({ type: 'int', default: 0 })
  reservedStock!: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  sku!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ProductImage, (image) => image.product, {
    cascade: true,
    eager: true,
  })
  images!: ProductImage[];

  @OneToMany(() => ProductVariant, (variant) => variant.product, {
    cascade: true,
  })
  variants!: ProductVariant[];

  @OneToMany(() => ProductReview, (review) => review.product)
  reviews!: ProductReview[];

  @OneToMany(() => WishlistItem, (wishlistItem) => wishlistItem.product)
  wishlistItems!: WishlistItem[];

  hasVariants?: boolean;
  priceFrom?: string;
  priceTo?: string;
  averageRating?: number;
  reviewCount?: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
