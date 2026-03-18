import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CatalogService } from './catalog.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsDto } from './dto/list-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('catalog/products')
export class CatalogProductsController {
  constructor(private readonly catalogService: CatalogService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Post()
  createProduct(
    @Body() createProductDto: CreateProductDto,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.createProduct(createProductDto, req.user);
  }

  @Get()
  listProducts(@Query() query: ListProductsDto) {
    return this.catalogService.listProducts(query);
  }

  @Get('slug/:slug')
  findProductBySlug(
    @Param('slug') slug: string,
    @Query('tenantId', new ParseUUIDPipe()) tenantId: string,
  ) {
    return this.catalogService.findProductBySlug(tenantId, slug);
  }

  @Get(':id')
  findProduct(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.catalogService.findProduct(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Patch(':id')
  updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateProductDto: UpdateProductDto,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.updateProduct(id, updateProductDto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Delete(':id')
  deleteProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.deleteProduct(id, req.user);
  }
}
