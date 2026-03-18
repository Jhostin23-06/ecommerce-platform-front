import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreatePickupPointDto } from './dto/create-pickup-point.dto';
import { ListPickupPointsDto } from './dto/list-pickup-points.dto';
import { UpdatePickupPointDto } from './dto/update-pickup-point.dto';
import { PickupPoint } from './pickup-point.entity';

type Actor = {
  role: UserRole;
  tenantId: string | null;
};

@Injectable()
export class PickupPointsService {
  constructor(
    @InjectRepository(PickupPoint)
    private readonly pickupPointsRepository: Repository<PickupPoint>,
  ) {}

  async create(createPickupPointDto: CreatePickupPointDto, actor: Actor): Promise<PickupPoint> {
    this.assertTenantManageAccess(createPickupPointDto.tenantId, actor);

    const pickupPoint = this.pickupPointsRepository.create({
      tenantId: createPickupPointDto.tenantId,
      name: createPickupPointDto.name.trim(),
      address: this.normalizeOptionalString(createPickupPointDto.address),
      windows: this.normalizeWindows(createPickupPointDto.windows),
      sortOrder: createPickupPointDto.sortOrder ?? 0,
      isActive: createPickupPointDto.isActive ?? true,
    });

    return this.pickupPointsRepository.save(pickupPoint);
  }

  async list(query: ListPickupPointsDto, actor: Actor): Promise<PickupPoint[]> {
    const includeInactive = query.includeInactive ?? false;
    if (includeInactive) {
      this.assertTenantManageAccess(query.tenantId, actor);
    }

    const qb = this.pickupPointsRepository
      .createQueryBuilder('pickupPoint')
      .where('pickupPoint.tenantId = :tenantId', { tenantId: query.tenantId })
      .orderBy('pickupPoint.sortOrder', 'ASC')
      .addOrderBy('pickupPoint.createdAt', 'ASC');

    if (!includeInactive) {
      qb.andWhere('pickupPoint.isActive = true');
    }

    return qb.getMany();
  }

  async update(pickupPointId: string, updatePickupPointDto: UpdatePickupPointDto, actor: Actor): Promise<PickupPoint> {
    const pickupPoint = await this.findOne(pickupPointId);
    this.assertTenantManageAccess(pickupPoint.tenantId, actor);

    if (updatePickupPointDto.tenantId !== undefined && updatePickupPointDto.tenantId !== pickupPoint.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }

    if (updatePickupPointDto.name !== undefined) {
      pickupPoint.name = updatePickupPointDto.name.trim();
    }
    if (updatePickupPointDto.address !== undefined) {
      pickupPoint.address = this.normalizeOptionalString(updatePickupPointDto.address);
    }
    if (updatePickupPointDto.windows !== undefined) {
      pickupPoint.windows = this.normalizeWindows(updatePickupPointDto.windows);
    }
    if (updatePickupPointDto.sortOrder !== undefined) {
      pickupPoint.sortOrder = updatePickupPointDto.sortOrder;
    }
    if (updatePickupPointDto.isActive !== undefined) {
      pickupPoint.isActive = updatePickupPointDto.isActive;
    }

    return this.pickupPointsRepository.save(pickupPoint);
  }

  async delete(pickupPointId: string, actor: Actor): Promise<{ success: true }> {
    const pickupPoint = await this.findOne(pickupPointId);
    this.assertTenantManageAccess(pickupPoint.tenantId, actor);
    await this.pickupPointsRepository.delete({ id: pickupPoint.id });
    return { success: true };
  }

  async findActiveForTenant(tenantId: string, pickupPointId: string): Promise<PickupPoint> {
    const pickupPoint = await this.pickupPointsRepository.findOne({
      where: {
        id: pickupPointId,
        tenantId,
        isActive: true,
      },
    });

    if (!pickupPoint) {
      throw new NotFoundException('Punto de recojo no encontrado');
    }

    return pickupPoint;
  }

  async findOne(pickupPointId: string): Promise<PickupPoint> {
    const pickupPoint = await this.pickupPointsRepository.findOne({ where: { id: pickupPointId } });
    if (!pickupPoint) {
      throw new NotFoundException('Punto de recojo no encontrado');
    }
    return pickupPoint;
  }

  private assertTenantManageAccess(targetTenantId: string, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }

    if (!actor.tenantId || actor.tenantId !== targetTenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private normalizeOptionalString(value?: string): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }

  private normalizeWindows(windows?: string[]): string[] {
    if (!windows?.length) {
      return [];
    }
    return windows
      .map((windowLabel) => windowLabel.trim())
      .filter((windowLabel, index, arr) => windowLabel.length > 0 && arr.indexOf(windowLabel) === index);
  }
}
