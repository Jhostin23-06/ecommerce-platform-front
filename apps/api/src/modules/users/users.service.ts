import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { User } from '../auth/user.entity';
import { Order } from '../orders/order.entity';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

type Actor = {
  userId: string;
  role: UserRole;
  tenantId: string | null;
};

export type TenantCustomerSummary = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
  ordersCount: number;
  totalSpent: string;
  lastOrderAt: Date | null;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
  ) {}

  async getMe(actor: Actor): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: actor.userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  async updateMyProfile(actor: Actor, dto: UpdateMyProfileDto): Promise<User> {
    const user = await this.getMe(actor);
    user.fullName = dto.fullName.trim();
    return this.usersRepository.save(user);
  }

  async changeMyPassword(actor: Actor, dto: ChangeMyPasswordDto): Promise<{ success: true }> {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :userId', { userId: actor.userId })
      .getOne();

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const isValidPassword = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValidPassword) {
      throw new ForbiddenException('La contraseña actual es incorrecta');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepository.save(user);
    return { success: true };
  }

  async listUsers(query: ListUsersDto, actor: Actor): Promise<User[]> {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return this.usersRepository.find({
        where: query.tenantId ? { tenantId: query.tenantId } : {},
        order: { createdAt: 'DESC' },
      });
    }

    if (!actor.tenantId) {
      return [];
    }

    return this.usersRepository.find({
      where: { tenantId: actor.tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async listCustomers(query: ListUsersDto, actor: Actor): Promise<TenantCustomerSummary[]> {
    const tenantId = this.resolveTenantScope(query, actor);
    if (!tenantId) {
      throw new BadRequestException('tenantId es obligatorio');
    }

    type CustomerRow = {
      id: string;
      email: string;
      fullName: string;
      isActive: boolean | 'true' | 'false';
      createdAt: Date | string;
      ordersCount: string;
      totalSpent: string | null;
      lastOrderAt: Date | string | null;
    };

    const rows = await this.ordersRepository
      .createQueryBuilder('order')
      .innerJoin(User, 'user', 'user.id = order.userId')
      .select('user.id', 'id')
      .addSelect('user.email', 'email')
      .addSelect('user.fullName', 'fullName')
      .addSelect('user.isActive', 'isActive')
      .addSelect('user.createdAt', 'createdAt')
      .addSelect('COUNT(order.id)', 'ordersCount')
      .addSelect('COALESCE(SUM(order.total), 0)', 'totalSpent')
      .addSelect('MAX(order.createdAt)', 'lastOrderAt')
      .where('order.tenantId = :tenantId', { tenantId })
      .andWhere('user.role = :role', { role: UserRole.CUSTOMER })
      .groupBy('user.id')
      .addGroupBy('user.email')
      .addGroupBy('user.fullName')
      .addGroupBy('user.isActive')
      .addGroupBy('user.createdAt')
      .orderBy('MAX(order.createdAt)', 'DESC')
      .getRawMany<CustomerRow>();

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      isActive: row.isActive === true || row.isActive === 'true',
      createdAt: new Date(row.createdAt),
      ordersCount: Number(row.ordersCount),
      totalSpent: row.totalSpent ?? '0.00',
      lastOrderAt: row.lastOrderAt ? new Date(row.lastOrderAt) : null,
    }));
  }

  async findOne(userId: string, actor: Actor): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    this.assertUserAccess(user, actor);
    return user;
  }

  async updateRole(userId: string, updateUserRoleDto: UpdateUserRoleDto, actor: Actor): Promise<User> {
    const user = await this.findOne(userId, actor);

    if (actor.role !== UserRole.PLATFORM_SUPERADMIN && updateUserRoleDto.role === UserRole.PLATFORM_SUPERADMIN) {
      throw new ForbiddenException('Solo el superadmin de plataforma puede asignar el rol platform_superadmin');
    }

    if (actor.role !== UserRole.PLATFORM_SUPERADMIN && updateUserRoleDto.role === UserRole.TENANT_ADMIN) {
      throw new ForbiddenException('Solo el superadmin de plataforma puede asignar el rol tenant_admin');
    }

    user.role = updateUserRoleDto.role;
    return this.usersRepository.save(user);
  }

  async updateStatus(userId: string, updateUserStatusDto: UpdateUserStatusDto, actor: Actor): Promise<User> {
    const user = await this.findOne(userId, actor);

    if (user.id === actor.userId && updateUserStatusDto.isActive === false) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta');
    }

    user.isActive = updateUserStatusDto.isActive;
    return this.usersRepository.save(user);
  }

  private assertUserAccess(targetUser: User, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }

    if (!actor.tenantId || targetUser.tenantId !== actor.tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }
  }

  private resolveTenantScope(query: ListUsersDto, actor: Actor): string | null {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return query.tenantId ?? null;
    }

    return actor.tenantId;
  }
}
