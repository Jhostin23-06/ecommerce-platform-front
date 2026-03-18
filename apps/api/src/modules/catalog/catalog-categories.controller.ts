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
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesDto } from './dto/list-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('catalog/categories')
export class CatalogCategoriesController {
  constructor(private readonly catalogService: CatalogService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Post()
  createCategory(
    @Body() createCategoryDto: CreateCategoryDto,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.createCategory(createCategoryDto, req.user);
  }

  @Get()
  listCategories(@Query() query: ListCategoriesDto) {
    return this.catalogService.listCategories(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Patch(':id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.updateCategory(id, updateCategoryDto, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.CATALOG_MANAGER)
  @Delete(':id')
  deleteCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: { role: UserRole; tenantId: string | null } },
  ) {
    return this.catalogService.deleteCategory(id, req.user);
  }
}
