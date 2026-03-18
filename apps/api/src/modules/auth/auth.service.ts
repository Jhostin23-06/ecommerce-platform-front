import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { CookieOptions } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { CustomerRegisterDto } from './dto/customer-register.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthEmailService } from './auth-email.service';
import { UserRole } from './enums/user-role.enum';
import { User } from './user.entity';

type SafeUser = Omit<
  User,
  | 'passwordHash'
  | 'refreshTokenHash'
  | 'refreshTokenExpiresAt'
  | 'emailVerificationTokenHash'
  | 'emailVerificationExpiresAt'
  | 'passwordResetTokenHash'
  | 'passwordResetExpiresAt'
>;
type TokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
};
type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};
type CookieSameSite = 'lax' | 'strict' | 'none';
type Actor = {
  userId: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
};
type RegisterResponse = {
  user: SafeUser;
  emailVerificationRequired: boolean;
  emailDeliveryEnabled: boolean;
  verificationEmailSent: boolean;
  verificationToken?: string;
};
type VerificationEmailDispatchResponse = {
  success: true;
  message: string;
  emailDeliveryEnabled: boolean;
  verificationEmailSent: boolean;
  verificationToken?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantsRepository: Repository<Tenant>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authEmailService: AuthEmailService,
  ) {}

  async register(registerDto: RegisterDto, actor: Actor): Promise<RegisterResponse> {
    const requestedRole = registerDto.role ?? UserRole.CUSTOMER;
    let targetTenantId = registerDto.tenantId ?? null;

    if (actor.role === UserRole.TENANT_ADMIN) {
      if (!actor.tenantId) {
        throw new ForbiddenException('La cuenta de admin de tenant no esta vinculada a un tenant');
      }

      if (requestedRole === UserRole.PLATFORM_SUPERADMIN || requestedRole === UserRole.TENANT_ADMIN) {
        throw new ForbiddenException('El admin de tenant no puede asignar este rol');
      }

      if (targetTenantId && targetTenantId !== actor.tenantId) {
        throw new NotFoundException('Tenant no encontrado');
      }

      targetTenantId = actor.tenantId;
    }

    if (requestedRole !== UserRole.PLATFORM_SUPERADMIN && requestedRole !== UserRole.CUSTOMER && !targetTenantId) {
      throw new BadRequestException('tenantId es obligatorio para este rol');
    }

    if (requestedRole === UserRole.CUSTOMER) {
      targetTenantId = null;
    }

    return this.createUser({
      email: registerDto.email,
      fullName: registerDto.fullName,
      password: registerDto.password,
      role: requestedRole,
      tenantId: targetTenantId,
    });
  }

  async registerBootstrap(registerDto: RegisterDto, bootstrapToken: string): Promise<RegisterResponse> {
    const expectedBootstrapToken = this.configService.get<string>('ADMIN_BOOTSTRAP_TOKEN')?.trim();
    if (!expectedBootstrapToken) {
      throw new UnauthorizedException('El token de bootstrap no esta configurado');
    }

    if (!bootstrapToken || bootstrapToken !== expectedBootstrapToken) {
      throw new UnauthorizedException('Token de bootstrap invalido');
    }

    const requestedRole = registerDto.role ?? UserRole.TENANT_ADMIN;
    if (requestedRole === UserRole.PLATFORM_SUPERADMIN) {
      const allowPlatformBootstrap =
        (this.configService.get<string>('ALLOW_PLATFORM_SUPERADMIN_BOOTSTRAP') ?? 'false').toLowerCase() === 'true';
      if (!allowPlatformBootstrap) {
        throw new ForbiddenException('El bootstrap de superadmin de plataforma esta deshabilitado');
      }
    }

    if (requestedRole !== UserRole.PLATFORM_SUPERADMIN && requestedRole !== UserRole.CUSTOMER && !registerDto.tenantId) {
      throw new BadRequestException('tenantId es obligatorio para este rol');
    }

    return this.createUser({
      email: registerDto.email,
      fullName: registerDto.fullName,
      password: registerDto.password,
      role: requestedRole,
      tenantId: registerDto.tenantId ?? null,
    });
  }

  async registerCustomer(customerRegisterDto: CustomerRegisterDto): Promise<RegisterResponse> {
    return this.createUser({
      email: customerRegisterDto.email,
      fullName: customerRegisterDto.fullName,
      password: customerRegisterDto.password,
      role: UserRole.CUSTOMER,
      tenantId: null,
    });
  }

  async requestPasswordReset(emailInput: string): Promise<{ success: true; message: string; resetToken?: string }> {
    const email = emailInput.toLowerCase().trim();
    const user = await this.usersRepository.findOne({
      where: { email },
      select: ['id', 'email', 'fullName', 'isActive'],
    });

    if (!user || !user.isActive) {
      return {
        success: true,
        message: 'Si la cuenta existe, se generaron instrucciones para restablecer la contrasena.',
      };
    }

    const resetToken = this.generateActionToken();
    const resetTokenHash = this.hashActionToken(resetToken);
    const resetExpiresAt = this.calculateExpiry(
      this.configService.get<string>('AUTH_PASSWORD_RESET_EXPIRES_IN') ?? '30m',
    );

    await this.usersRepository.update(
      { id: user.id },
      {
        passwordResetTokenHash: resetTokenHash,
        passwordResetExpiresAt: resetExpiresAt,
      },
    );

    await this.authEmailService.sendPasswordResetEmail({
      toEmail: user.email,
      fullName: user.fullName,
      token: resetToken,
    });

    return {
      success: true,
      message: 'Si la cuenta existe, se generaron instrucciones para restablecer la contrasena.',
      ...(this.shouldExposeDebugTokens() ? { resetToken } : {}),
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: true }> {
    const tokenHash = this.hashActionToken(token);
    const user = await this.usersRepository.findOne({
      where: { passwordResetTokenHash: tokenHash },
      select: [
        'id',
        'passwordResetTokenHash',
        'passwordResetExpiresAt',
      ],
    });

    if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt) {
      throw new UnauthorizedException('Token de restablecimiento de contrasena invalido o expirado');
    }

    if (user.passwordResetExpiresAt.getTime() <= Date.now()) {
      await this.usersRepository.update(
        { id: user.id },
        {
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
      );
      throw new UnauthorizedException('Token de restablecimiento de contrasena invalido o expirado');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.update(
      { id: user.id },
      {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    );

    return { success: true };
  }

  async verifyEmail(token: string): Promise<{ success: true }> {
    const tokenHash = this.hashActionToken(token);
    const user = await this.usersRepository.findOne({
      where: { emailVerificationTokenHash: tokenHash },
      select: ['id', 'emailVerificationTokenHash', 'emailVerificationExpiresAt'],
    });

    if (!user || !user.emailVerificationTokenHash || !user.emailVerificationExpiresAt) {
      throw new UnauthorizedException('Token de verificacion de correo invalido o expirado');
    }

    if (user.emailVerificationExpiresAt.getTime() <= Date.now()) {
      await this.usersRepository.update(
        { id: user.id },
        {
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      );
      throw new UnauthorizedException('Token de verificacion de correo invalido o expirado');
    }

    await this.usersRepository.update(
      { id: user.id },
      {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    );

    return { success: true };
  }

  async activateAccount(token: string, newPassword: string): Promise<{ success: true }> {
    const tokenHash = this.hashActionToken(token);
    const user = await this.usersRepository.findOne({
      where: { emailVerificationTokenHash: tokenHash },
      select: ['id', 'isActive', 'emailVerificationTokenHash', 'emailVerificationExpiresAt'],
    });

    if (!user || !user.emailVerificationTokenHash || !user.emailVerificationExpiresAt || !user.isActive) {
      throw new UnauthorizedException('Token de activacion invalido o expirado');
    }

    if (user.emailVerificationExpiresAt.getTime() <= Date.now()) {
      await this.usersRepository.update(
        { id: user.id },
        {
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      );
      throw new UnauthorizedException('Token de activacion invalido o expirado');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.update(
      { id: user.id },
      {
        passwordHash,
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    );

    return { success: true };
  }

  async resendEmailVerification(userId: string): Promise<VerificationEmailDispatchResponse> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'fullName', 'role', 'isActive', 'emailVerifiedAt'],
    });

    if (!user || !user.isActive) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.emailVerifiedAt) {
      return {
        success: true,
        message: 'El correo ya esta verificado.',
        emailDeliveryEnabled: this.authEmailService.isEnabled(),
        verificationEmailSent: false,
      };
    }

    return this.dispatchVerificationEmail(user);
  }

  async resendEmailVerificationByEmail(emailInput: string): Promise<VerificationEmailDispatchResponse> {
    const email = emailInput.toLowerCase().trim();
    const user = await this.usersRepository.findOne({
      where: { email },
      select: ['id', 'email', 'fullName', 'role', 'isActive', 'emailVerifiedAt'],
    });

    if (!user || !user.isActive || user.emailVerifiedAt) {
      return {
        success: true,
        message: 'Si la cuenta existe y esta pendiente de verificacion, se generaron instrucciones por correo.',
        emailDeliveryEnabled: this.authEmailService.isEnabled(),
        verificationEmailSent: false,
      };
    }

    const dispatch = await this.dispatchVerificationEmail(user);
    return {
      ...dispatch,
      message: 'Si la cuenta existe y esta pendiente de verificacion, se generaron instrucciones por correo.',
    };
  }

  async login(loginDto: LoginDto): Promise<AuthTokens & { user: SafeUser }> {
    const email = loginDto.email.toLowerCase().trim();
    const user = await this.usersRepository.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'fullName',
        'role',
        'tenantId',
        'isActive',
        'emailVerifiedAt',
        'createdAt',
        'updatedAt',
        'passwordHash',
        'refreshTokenHash',
        'refreshTokenExpiresAt',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const isValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    const requireVerifiedEmail =
      (this.configService.get<string>('AUTH_REQUIRE_EMAIL_VERIFIED') ?? 'false').toLowerCase() === 'true';
    const requiresVerifiedEmailByRole = user.role === UserRole.CUSTOMER;
    const requiresStaffActivationByRole = user.role !== UserRole.CUSTOMER && this.shouldRequireStaffActivation();
    if ((requireVerifiedEmail && requiresVerifiedEmailByRole && !user.emailVerifiedAt) || (requiresStaffActivationByRole && !user.emailVerifiedAt)) {
      if (requiresStaffActivationByRole) {
        throw new UnauthorizedException('La cuenta administrativa no esta activada');
      }
      throw new UnauthorizedException('El correo no esta verificado');
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const tokens = await this.generateTokens(payload);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: this.toSafeUser(user),
    };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const decoded = await this.verifyRefreshToken(refreshToken);
    const user = await this.usersRepository.findOne({
      where: { id: decoded.sub },
      select: [
        'id',
        'email',
        'fullName',
        'role',
        'tenantId',
        'isActive',
        'refreshTokenHash',
        'refreshTokenExpiresAt',
      ],
    });

    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('Token de refresco invalido');
    }

    if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt.getTime() <= Date.now()) {
      await this.usersRepository.update({ id: user.id }, { refreshTokenHash: null, refreshTokenExpiresAt: null });
      throw new UnauthorizedException('El token de refresco expiro');
    }

    const isTokenMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isTokenMatch) {
      throw new UnauthorizedException('Token de refresco invalido');
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const tokens = await this.generateTokens(payload);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(userId: string): Promise<{ success: true }> {
    await this.usersRepository.update({ id: userId }, { refreshTokenHash: null, refreshTokenExpiresAt: null });
    return { success: true };
  }

  getRefreshCookieName(): string {
    return this.configService.get<string>('AUTH_REFRESH_COOKIE_NAME') ?? 'refresh_token';
  }

  getRefreshCookieOptions(): CookieOptions {
    const secureFlag = (this.configService.get<string>('AUTH_COOKIE_SECURE') ?? 'false').toLowerCase() === 'true';
    const sameSiteRaw = (this.configService.get<string>('AUTH_COOKIE_SAMESITE') ?? 'lax').toLowerCase();
    const sameSite: CookieSameSite = sameSiteRaw === 'strict' || sameSiteRaw === 'none' ? sameSiteRaw : 'lax';
    const domain = this.configService.get<string>('AUTH_COOKIE_DOMAIN')?.trim() || undefined;
    const refreshTtl = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    return {
      httpOnly: true,
      secure: secureFlag,
      sameSite,
      path: '/auth',
      domain,
      maxAge: this.calculateDurationMs(refreshTtl),
    };
  }

  getRefreshCookieClearOptions(): CookieOptions {
    const cookieOptions = this.getRefreshCookieOptions();
    return {
      ...cookieOptions,
      maxAge: 0,
    };
  }

  async getProfile(userId: string): Promise<SafeUser> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.toSafeUser(user);
  }

  private async generateTokens(payload: TokenPayload): Promise<AuthTokens> {
    const accessSecret = this.configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me';
    const accessExpiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m';
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret-change-me';
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiresIn as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn as any,
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const refreshTtl = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    await this.usersRepository.update(
      { id: userId },
      {
        refreshTokenHash,
        refreshTokenExpiresAt: this.calculateRefreshExpiry(refreshTtl),
      },
    );
  }

  private async verifyRefreshToken(refreshToken: string): Promise<TokenPayload> {
    const refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret-change-me';
    try {
      return await this.jwtService.verifyAsync<TokenPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Token de refresco invalido');
    }
  }

  private calculateRefreshExpiry(ttl: string): Date {
    const now = new Date();
    return new Date(now.getTime() + this.calculateDurationMs(ttl));
  }

  private calculateDurationMs(ttl: string): number {
    const parsed = Number(ttl.slice(0, -1));
    const unit = ttl.slice(-1);

    if (Number.isNaN(parsed) || parsed <= 0) {
      return 7 * 24 * 60 * 60 * 1000;
    }

    const multipliers: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return parsed * (multipliers[unit] ?? multipliers.d);
  }

  private toSafeUser(user: User): SafeUser {
    // TypeORM may include passwordHash only when select is overridden.
    // Excluding it explicitly keeps API response safe.
    const {
      passwordHash: _passwordHash,
      refreshTokenHash: _refreshTokenHash,
      refreshTokenExpiresAt: _refreshTokenExpiresAt,
      emailVerificationTokenHash: _emailVerificationTokenHash,
      emailVerificationExpiresAt: _emailVerificationExpiresAt,
      passwordResetTokenHash: _passwordResetTokenHash,
      passwordResetExpiresAt: _passwordResetExpiresAt,
      ...safeUser
    } = user as User & {
      passwordHash?: string;
      refreshTokenHash?: string | null;
      refreshTokenExpiresAt?: Date | null;
      emailVerificationTokenHash?: string | null;
      emailVerificationExpiresAt?: Date | null;
      passwordResetTokenHash?: string | null;
      passwordResetExpiresAt?: Date | null;
    };
    return safeUser as SafeUser;
  }

  private async createUser(payload: {
    email: string;
    fullName: string;
    password: string;
    role: UserRole;
    tenantId: string | null;
  }): Promise<RegisterResponse> {
    const email = payload.email.toLowerCase().trim();
    const existingUser = await this.usersRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new ConflictException('El correo ya esta registrado');
    }

    if (payload.tenantId) {
      const tenant = await this.tenantsRepository.findOne({ where: { id: payload.tenantId } });
      if (!tenant) {
        throw new NotFoundException('Tenant no encontrado');
      }
    }

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const shouldAutoVerifyEmail =
      payload.role === UserRole.CUSTOMER ? false : !this.shouldRequireStaffActivation();
    const verificationToken = shouldAutoVerifyEmail ? null : this.generateActionToken();
    const verificationTokenHash = verificationToken ? this.hashActionToken(verificationToken) : null;
    const verificationExpiresAt = verificationToken
      ? this.calculateExpiry(this.configService.get<string>('AUTH_EMAIL_VERIFICATION_EXPIRES_IN') ?? '24h')
      : null;
    const emailDeliveryEnabled = this.authEmailService.isEnabled();

    const user = this.usersRepository.create({
      email,
      fullName: payload.fullName.trim(),
      passwordHash,
      role: payload.role,
      tenantId: payload.tenantId,
      emailVerifiedAt: shouldAutoVerifyEmail ? new Date() : null,
      emailVerificationTokenHash: verificationTokenHash,
      emailVerificationExpiresAt: verificationExpiresAt,
    });
    const savedUser = await this.usersRepository.save(user);
    let verificationEmailSent = false;

    if (verificationToken && emailDeliveryEnabled) {
      if (payload.role === UserRole.CUSTOMER) {
        await this.authEmailService.sendVerificationEmail({
          toEmail: savedUser.email,
          fullName: savedUser.fullName,
          token: verificationToken,
        });
      } else {
        await this.authEmailService.sendAccountActivationEmail({
          toEmail: savedUser.email,
          fullName: savedUser.fullName,
          token: verificationToken,
        });
      }
      verificationEmailSent = true;
    }

    return {
      user: this.toSafeUser(savedUser),
      emailVerificationRequired: !shouldAutoVerifyEmail,
      emailDeliveryEnabled,
      verificationEmailSent,
      ...(this.shouldExposeDebugTokens() && verificationToken
        ? { verificationToken }
        : {}),
    };
  }

  private async dispatchVerificationEmail(
    user: Pick<User, 'id' | 'email' | 'fullName' | 'role'>,
  ): Promise<VerificationEmailDispatchResponse> {
    const verificationToken = this.generateActionToken();
    const verificationTokenHash = this.hashActionToken(verificationToken);
    const verificationExpiresAt = this.calculateExpiry(
      this.configService.get<string>('AUTH_EMAIL_VERIFICATION_EXPIRES_IN') ?? '24h',
    );
    const emailDeliveryEnabled = this.authEmailService.isEnabled();

    await this.usersRepository.update(
      { id: user.id },
      {
        emailVerificationTokenHash: verificationTokenHash,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
    );

    let verificationEmailSent = false;
    if (emailDeliveryEnabled) {
      if (user.role === UserRole.CUSTOMER) {
        await this.authEmailService.sendVerificationEmail({
          toEmail: user.email,
          fullName: user.fullName,
          token: verificationToken,
        });
      } else {
        await this.authEmailService.sendAccountActivationEmail({
          toEmail: user.email,
          fullName: user.fullName,
          token: verificationToken,
        });
      }
      verificationEmailSent = true;
    }

    return {
      success: true,
      message: emailDeliveryEnabled
        ? 'Se envio el correo de verificacion.'
        : 'El envio de correos esta desactivado. No se envio el correo de verificacion.',
      emailDeliveryEnabled,
      verificationEmailSent,
      ...(this.shouldExposeDebugTokens() ? { verificationToken } : {}),
    };
  }

  private hashActionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateActionToken(): string {
    return randomBytes(32).toString('hex');
  }

  private calculateExpiry(ttl: string): Date {
    const now = new Date();
    return new Date(now.getTime() + this.calculateDurationMs(ttl));
  }

  private shouldExposeDebugTokens(): boolean {
    const explicit = this.configService.get<string>('AUTH_EXPOSE_DEBUG_TOKENS');
    if (explicit) {
      return explicit.toLowerCase() === 'true';
    }

    return (this.configService.get<string>('NODE_ENV') ?? 'development').toLowerCase() !== 'production';
  }

  private shouldRequireStaffActivation(): boolean {
    const explicit = this.configService.get<string>('AUTH_REQUIRE_STAFF_ACTIVATION');
    if (explicit) {
      return explicit.toLowerCase() === 'true';
    }

    return (this.configService.get<string>('NODE_ENV') ?? 'development').toLowerCase() === 'production';
  }
}
