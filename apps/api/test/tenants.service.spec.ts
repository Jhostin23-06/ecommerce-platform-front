import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantsService } from '../src/modules/tenants/tenants.service';

describe('TenantsService bootstrap', () => {
  const createTenantDto = { name: 'Acme', slug: 'acme' };

  it('rejects bootstrap when token does not match', async () => {
    const tenantsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };
    const configService = new ConfigService({
      ADMIN_BOOTSTRAP_TOKEN: 'expected-token',
    });
    const service = new TenantsService(tenantsRepository as any, configService);

    await expect(service.createBootstrap(createTenantDto, 'wrong-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('creates tenant when bootstrap token is valid', async () => {
    const createdTenant = {
      id: 'tenant-id',
      ...createTenantDto,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const tenantsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue(createdTenant),
      save: jest.fn().mockResolvedValue(createdTenant),
      find: jest.fn(),
    };
    const configService = new ConfigService({
      ADMIN_BOOTSTRAP_TOKEN: 'expected-token',
    });
    const service = new TenantsService(tenantsRepository as any, configService);

    const result = await service.createBootstrap(createTenantDto, 'expected-token');

    expect(result.slug).toBe('acme');
    expect(tenantsRepository.save).toHaveBeenCalledTimes(1);
  });
});
