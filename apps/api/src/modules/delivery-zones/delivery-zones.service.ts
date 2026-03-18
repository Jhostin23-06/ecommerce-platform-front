import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { ListDeliveryZonesDto } from './dto/list-delivery-zones.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { DeliveryZone } from './delivery-zone.entity';

type Actor = {
  role: UserRole;
  tenantId: string | null;
};

type DeliveryCoverage = {
  zone: DeliveryZone;
  shippingFee: number;
  estimatedMinutes: number;
};

@Injectable()
export class DeliveryZonesService {
  constructor(
    @InjectRepository(DeliveryZone)
    private readonly deliveryZonesRepository: Repository<DeliveryZone>,
  ) {}

  async create(createDeliveryZoneDto: CreateDeliveryZoneDto, actor: Actor): Promise<DeliveryZone> {
    this.assertTenantManageAccess(createDeliveryZoneDto.tenantId, actor);

    const deliveryZone = this.deliveryZonesRepository.create({
      tenantId: createDeliveryZoneDto.tenantId,
      name: createDeliveryZoneDto.name.trim(),
      districts: this.normalizeDistricts(createDeliveryZoneDto.districts),
      fee: this.toMoney(createDeliveryZoneDto.fee),
      minOrderAmount: this.toMoney(createDeliveryZoneDto.minOrderAmount ?? 0),
      freeShippingFrom:
        createDeliveryZoneDto.freeShippingFrom !== undefined ? this.toMoney(createDeliveryZoneDto.freeShippingFrom) : null,
      etaMinutes: createDeliveryZoneDto.etaMinutes ?? 180,
      sortOrder: createDeliveryZoneDto.sortOrder ?? 0,
      isActive: createDeliveryZoneDto.isActive ?? true,
    });

    return this.deliveryZonesRepository.save(deliveryZone);
  }

  async list(query: ListDeliveryZonesDto, actor: Actor): Promise<DeliveryZone[]> {
    const includeInactive = query.includeInactive ?? false;
    if (includeInactive) {
      this.assertTenantManageAccess(query.tenantId, actor);
    }

    const qb = this.deliveryZonesRepository
      .createQueryBuilder('deliveryZone')
      .where('deliveryZone.tenantId = :tenantId', { tenantId: query.tenantId })
      .orderBy('deliveryZone.sortOrder', 'ASC')
      .addOrderBy('deliveryZone.createdAt', 'ASC');

    if (!includeInactive) {
      qb.andWhere('deliveryZone.isActive = true');
    }

    return qb.getMany();
  }

  async update(deliveryZoneId: string, updateDeliveryZoneDto: UpdateDeliveryZoneDto, actor: Actor): Promise<DeliveryZone> {
    const deliveryZone = await this.findOne(deliveryZoneId);
    this.assertTenantManageAccess(deliveryZone.tenantId, actor);

    if (updateDeliveryZoneDto.tenantId !== undefined && updateDeliveryZoneDto.tenantId !== deliveryZone.tenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }

    if (updateDeliveryZoneDto.name !== undefined) {
      deliveryZone.name = updateDeliveryZoneDto.name.trim();
    }
    if (updateDeliveryZoneDto.districts !== undefined) {
      deliveryZone.districts = this.normalizeDistricts(updateDeliveryZoneDto.districts);
    }
    if (updateDeliveryZoneDto.fee !== undefined) {
      deliveryZone.fee = this.toMoney(updateDeliveryZoneDto.fee);
    }
    if (updateDeliveryZoneDto.minOrderAmount !== undefined) {
      deliveryZone.minOrderAmount = this.toMoney(updateDeliveryZoneDto.minOrderAmount);
    }
    if (updateDeliveryZoneDto.freeShippingFrom !== undefined) {
      deliveryZone.freeShippingFrom =
        updateDeliveryZoneDto.freeShippingFrom === null ? null : this.toMoney(updateDeliveryZoneDto.freeShippingFrom);
    }
    if (updateDeliveryZoneDto.etaMinutes !== undefined) {
      deliveryZone.etaMinutes = updateDeliveryZoneDto.etaMinutes;
    }
    if (updateDeliveryZoneDto.sortOrder !== undefined) {
      deliveryZone.sortOrder = updateDeliveryZoneDto.sortOrder;
    }
    if (updateDeliveryZoneDto.isActive !== undefined) {
      deliveryZone.isActive = updateDeliveryZoneDto.isActive;
    }

    return this.deliveryZonesRepository.save(deliveryZone);
  }

  async delete(deliveryZoneId: string, actor: Actor): Promise<{ success: true }> {
    const deliveryZone = await this.findOne(deliveryZoneId);
    this.assertTenantManageAccess(deliveryZone.tenantId, actor);
    await this.deliveryZonesRepository.delete({ id: deliveryZone.id });
    return { success: true };
  }

  async resolveCoverage(tenantId: string, districtRaw: string, subtotalAfterDiscount: number): Promise<DeliveryCoverage> {
    const district = this.normalizeDistrict(districtRaw);
    if (!district) {
      throw new NotFoundException('El distrito de entrega es obligatorio');
    }

    const zones = await this.deliveryZonesRepository.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const matchingZone = zones.find((zone) => zone.districts.includes(district));
    if (!matchingZone) {
      throw new NotFoundException(`No hay cobertura de delivery para el distrito "${districtRaw}"`);
    }

    const minOrderAmount = Number(matchingZone.minOrderAmount ?? 0);
    if (subtotalAfterDiscount < minOrderAmount) {
      throw new ConflictException(
        `Minimum order for ${matchingZone.name} is S/${this.toMoney(minOrderAmount)}`,
      );
    }

    const freeShippingFrom = matchingZone.freeShippingFrom ? Number(matchingZone.freeShippingFrom) : null;
    const shippingFee =
      freeShippingFrom !== null && subtotalAfterDiscount >= freeShippingFrom ? 0 : Number(matchingZone.fee);

    return {
      zone: matchingZone,
      shippingFee,
      estimatedMinutes: matchingZone.etaMinutes,
    };
  }

  async findOne(deliveryZoneId: string): Promise<DeliveryZone> {
    const deliveryZone = await this.deliveryZonesRepository.findOne({ where: { id: deliveryZoneId } });
    if (!deliveryZone) {
      throw new NotFoundException('Zona de entrega no encontrada');
    }
    return deliveryZone;
  }

  private assertTenantManageAccess(targetTenantId: string, actor: Actor): void {
    if (actor.role === UserRole.PLATFORM_SUPERADMIN) {
      return;
    }
    if (!actor.tenantId || actor.tenantId !== targetTenantId) {
      throw new NotFoundException('Tenant no encontrado');
    }
  }

  private normalizeDistrict(districtRaw?: string): string | null {
    if (!districtRaw) {
      return null;
    }
    const normalized = districtRaw.trim().toUpperCase();
    return normalized.length ? normalized : null;
  }

  private normalizeDistricts(districts: string[]): string[] {
    return districts
      .map((district) => this.normalizeDistrict(district))
      .filter((district, index, arr): district is string => !!district && arr.indexOf(district) === index);
  }

  private toMoney(value: number): string {
    return value.toFixed(2);
  }
}
