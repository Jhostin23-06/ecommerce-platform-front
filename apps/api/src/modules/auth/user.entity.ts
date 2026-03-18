import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { UserRole } from './enums/user-role.enum';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 160, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 120 })
  fullName!: string;

  @Column({ type: 'varchar', select: false })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CUSTOMER })
  role!: UserRole;

  @Column({ type: 'uuid', nullable: true })
  tenantId!: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  emailVerificationTokenHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  emailVerificationExpiresAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  passwordResetTokenHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true, select: false })
  passwordResetExpiresAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  refreshTokenHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  refreshTokenExpiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
