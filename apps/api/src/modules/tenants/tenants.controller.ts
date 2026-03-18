import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { BootstrapTenantDto } from './dto/bootstrap-tenant.dto';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { Tenant } from './tenant.entity';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post('bootstrap')
  createBootstrap(@Body() bootstrapTenantDto: BootstrapTenantDto): Promise<Tenant> {
    return this.tenantsService.createBootstrap(bootstrapTenantDto.tenant, bootstrapTenantDto.bootstrapToken);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN)
  @Post()
  create(@Body() createTenantDto: CreateTenantDto): Promise<Tenant> {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  findAll(): Promise<Tenant[]> {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Tenant> {
    return this.tenantsService.findOne(id);
  }
}
