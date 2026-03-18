import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { BillingService } from './billing.service';
import { BillingSettingsQueryDto } from './dto/billing-settings-query.dto';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
    email: string;
  };
};

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Get('settings')
  getSettings(@Query() query: BillingSettingsQueryDto, @Req() req: ActorRequest) {
    return this.billingService.getSettings(query, req.user);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Put('settings')
  updateSettings(
    @Query() query: BillingSettingsQueryDto,
    @Body() payload: UpdateBillingSettingsDto,
    @Req() req: ActorRequest,
  ) {
    return this.billingService.upsertSettings(query, payload, req.user);
  }

  @Roles(
    UserRole.PLATFORM_SUPERADMIN,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.CUSTOMER,
  )
  @Get('orders/:orderId/documents')
  listOrderDocuments(@Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: ActorRequest) {
    return this.billingService.listOrderDocuments(orderId, req.user);
  }

  @Roles(
    UserRole.PLATFORM_SUPERADMIN,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.CUSTOMER,
  )
  @Get('orders/:orderId/documents/latest/link')
  getLatestOrderDocumentLink(@Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: ActorRequest) {
    return this.billingService.getLatestOrderDocumentLink(orderId, req.user);
  }

  @Roles(
    UserRole.PLATFORM_SUPERADMIN,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.CUSTOMER,
  )
  @Get('orders/:orderId/documents/latest/pdf')
  async getLatestOrderDocumentPdf(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Req() req: ActorRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.billingService.getLatestOrderDocumentPdf(orderId, req.user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${file.fileName}"`);
    return new StreamableFile(file.content);
  }

  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Post('orders/:orderId/issue')
  issueOrderDocument(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.billingService.issueDocumentForPaidOrder(orderId, 'manual');
  }
}
