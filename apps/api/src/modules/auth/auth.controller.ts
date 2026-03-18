import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BootstrapRegisterDto } from './dto/bootstrap-register.dto';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResendVerificationByEmailDto } from './dto/resend-verification-by-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { UserRole } from './enums/user-role.enum';

type AuthenticatedRequest = {
  user: {
    userId: string;
    email: string;
    role: UserRole;
    tenantId: string | null;
  };
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authRateLimitService: AuthRateLimitService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Post('register')
  register(
    @Body() registerDto: RegisterDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.authService.register(registerDto, req.user);
  }

  @Post('register/bootstrap')
  registerBootstrap(@Body() bootstrapRegisterDto: BootstrapRegisterDto) {
    return this.authService.registerBootstrap(
      bootstrapRegisterDto.register,
      bootstrapRegisterDto.bootstrapToken,
    );
  }

  @Post('register/customer')
  registerCustomer(@Body() customerRegisterDto: CustomerRegisterDto) {
    return this.authService.registerCustomer(customerRegisterDto);
  }

  @Post('request-password-reset')
  @HttpCode(200)
  requestPasswordReset(@Body() requestPasswordResetDto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(requestPasswordResetDto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto.token, resetPasswordDto.newPassword);
  }

  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Post('activate-account')
  @HttpCode(200)
  activateAccount(@Body() activateAccountDto: ActivateAccountDto) {
    return this.authService.activateAccount(activateAccountDto.token, activateAccountDto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('verification/resend')
  @HttpCode(200)
  resendVerification(@Req() req: AuthenticatedRequest) {
    return this.authService.resendEmailVerification(req.user.userId);
  }

  @Post('verification/resend-by-email')
  @HttpCode(200)
  resendVerificationByEmail(@Body() resendVerificationByEmailDto: ResendVerificationByEmailDto) {
    return this.authService.resendEmailVerificationByEmail(resendVerificationByEmailDto.email);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.authRateLimitService.assertLoginAllowed(this.resolveClientIp(request));
    const authResult = await this.authService.login(loginDto);

    response.cookie(
      this.authService.getRefreshCookieName(),
      authResult.refreshToken,
      this.authService.getRefreshCookieOptions(),
    );

    return {
      accessToken: authResult.accessToken,
      user: authResult.user,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authRateLimitService.assertRefreshAllowed(this.resolveClientIp(request));
    const cookieToken = request.cookies?.[this.authService.getRefreshCookieName()];
    const token = cookieToken || refreshTokenDto.refreshToken;

    if (!token) {
      throw new UnauthorizedException('El token de refresco es obligatorio');
    }

    const tokens = await this.authService.refresh(token);
    response.cookie(
      this.authService.getRefreshCookieName(),
      tokens.refreshToken,
      this.authService.getRefreshCookieOptions(),
    );

    return {
      accessToken: tokens.accessToken,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: AuthenticatedRequest & Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.user.userId);
    response.clearCookie(
      this.authService.getRefreshCookieName(),
      this.authService.getRefreshCookieClearOptions(),
    );

    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Req() req: AuthenticatedRequest) {
    return this.authService.getProfile(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_SUPERADMIN, UserRole.TENANT_ADMIN)
  @Get('admin-check')
  adminCheck() {
    return {
      status: 'ok',
      message: 'Autorizado con rol de administrador',
    };
  }

  private resolveClientIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
      return forwarded.split(',')[0].trim();
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
