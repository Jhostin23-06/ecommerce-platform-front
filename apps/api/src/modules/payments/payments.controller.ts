import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { PaymentsService } from './payments.service';

type ActorRequest = {
  user: {
    userId: string;
    role: UserRole;
    tenantId: string | null;
    email: string;
  };
};

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Post('checkout-session')
  createCheckoutSession(@Req() req: ActorRequest, @Body() createCheckoutSessionDto: CreateCheckoutSessionDto) {
    return this.paymentsService.createCheckoutSession(req.user, createCheckoutSessionDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Get('checkout-session/:sessionId/confirm')
  confirmCheckoutSession(
    @Req() req: ActorRequest,
    @Param('sessionId') sessionId: string,
  ) {
    return this.paymentsService.confirmCheckoutSession(req.user, sessionId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Get('order/:orderId')
  listOrderPayments(@Req() req: ActorRequest, @Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.paymentsService.listOrderPayments(orderId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CUSTOMER,
    UserRole.PLATFORM_SUPERADMIN,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
  )
  @Get('order/:orderId/refunds')
  listOrderRefunds(@Req() req: ActorRequest, @Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.paymentsService.listOrderRefunds(orderId, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN, UserRole.ORDER_MANAGER, UserRole.SUPPORT)
  @Post('order/:orderId/refund')
  refundOrder(
    @Req() req: ActorRequest,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() createRefundDto: CreateRefundDto,
  ) {
    return this.paymentsService.refundOrder(req.user, orderId, createRefundDto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.CUSTOMER,
    UserRole.TENANT_ADMIN,
    UserRole.ORDER_MANAGER,
    UserRole.SUPPORT,
    UserRole.PLATFORM_SUPERADMIN,
  )
  @Post('order/:orderId/reconcile')
  reconcileOrderPayment(@Req() req: ActorRequest, @Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.paymentsService.reconcileOrderPayment(req.user, orderId);
  }

  @Post('webhook')
  async stripeWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') stripeSignature?: string,
  ) {
    const payload = req.rawBody ?? req.body;
    await this.paymentsService.handleStripeWebhook(payload, stripeSignature);
    return { received: true };
  }
}
