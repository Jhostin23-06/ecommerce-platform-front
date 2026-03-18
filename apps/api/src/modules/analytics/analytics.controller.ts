import { Controller, Get, ParseIntPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { AnalyticsService } from './analytics.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  overview(
    @Query('tenantId') tenantId: string | undefined,
    @Query('rangeDays', new ParseIntPipe({ optional: true })) rangeDays: number | undefined,
    @Req() req: ActorRequest,
  ) {
    return this.analyticsService.getOverview(req.user, tenantId, rangeDays ?? 30);
  }

  @Get('exports/orders.csv')
  async exportOrders(
    @Query('tenantId') tenantId: string | undefined,
    @Req() req: ActorRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.analyticsService.exportOrdersCsv(req.user, tenantId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders-report.csv"');
    return csv;
  }

  @Get('exports/products.csv')
  async exportProducts(
    @Query('tenantId') tenantId: string | undefined,
    @Req() req: ActorRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.analyticsService.exportProductsCsv(req.user, tenantId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products-report.csv"');
    return csv;
  }
}
