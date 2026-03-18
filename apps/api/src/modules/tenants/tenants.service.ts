import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Tenant } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
    private readonly configService: ConfigService,
  ) {}

  async create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantsRepository.findOne({
      where: [{ slug: createTenantDto.slug }, { name: createTenantDto.name }],
    });

    if (existing) {
      throw new ConflictException('Ya existe un tenant con el mismo nombre o slug');
    }

    const tenant = this.tenantsRepository.create({
      name: createTenantDto.name.trim(),
      slug: createTenantDto.slug.trim(),
    });

    return this.tenantsRepository.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantsRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantsRepository.findOne({ where: { id } });

    if (!tenant) {
      throw new NotFoundException('Tenant no encontrado');
    }

    return tenant;
  }

  async createBootstrap(createTenantDto: CreateTenantDto, bootstrapToken: string): Promise<Tenant> {
    const expectedBootstrapToken = this.configService.get<string>('ADMIN_BOOTSTRAP_TOKEN')?.trim();
    if (!expectedBootstrapToken) {
      throw new UnauthorizedException('El token de bootstrap no esta configurado');
    }

    if (!bootstrapToken || bootstrapToken !== expectedBootstrapToken) {
      throw new UnauthorizedException('Token de bootstrap invalido');
    }

    return this.create(createTenantDto);
  }
}
