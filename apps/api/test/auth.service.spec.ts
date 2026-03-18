import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthService } from '../src/modules/auth/auth.service';

describe('AuthService recovery and verification', () => {
  function createService(overrides?: {
    usersRepository?: Record<string, jest.Mock>;
    tenantsRepository?: Record<string, jest.Mock>;
    config?: Record<string, string>;
    authEmailService?: Record<string, jest.Mock>;
  }) {
    const usersRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      save: jest.fn(),
      ...overrides?.usersRepository,
    };
    const tenantsRepository = {
      findOne: jest.fn(),
      ...overrides?.tenantsRepository,
    };
    const jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    const configService = new ConfigService({
      NODE_ENV: 'development',
      ...overrides?.config,
    });
    const authEmailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      ...overrides?.authEmailService,
    };

    const service = new AuthService(
      usersRepository as any,
      tenantsRepository as any,
      jwtService as any,
      configService,
      authEmailService as any,
    );

    return {
      service,
      usersRepository,
      authEmailService,
    };
  }

  it('creates password reset token for active user', async () => {
    const { service, usersRepository, authEmailService } = createService({
      usersRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'demo@test.com',
          fullName: 'Demo User',
          isActive: true,
        }),
      },
    });

    const result = await service.requestPasswordReset('demo@test.com');

    expect(result.success).toBe(true);
    expect(result.resetToken).toBeDefined();
    expect(usersRepository.update).toHaveBeenCalledTimes(1);
    const updatePayload = usersRepository.update.mock.calls[0][1];
    expect(updatePayload.passwordResetTokenHash).toHaveLength(64);
    expect(updatePayload.passwordResetExpiresAt).toBeInstanceOf(Date);
    expect(authEmailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('resets password with valid token', async () => {
    const rawToken = 'token-123';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const { service, usersRepository } = createService({
      usersRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-2',
          passwordResetTokenHash: tokenHash,
          passwordResetExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    const result = await service.resetPassword(rawToken, 'NuevaClave123');

    expect(result.success).toBe(true);
    expect(usersRepository.update).toHaveBeenCalledTimes(1);
    const updatePayload = usersRepository.update.mock.calls[0][1];
    expect(updatePayload.passwordHash).toBeDefined();
    expect(updatePayload.passwordResetTokenHash).toBeNull();
    expect(updatePayload.refreshTokenHash).toBeNull();
  });

  it('verifies email with valid token', async () => {
    const rawToken = 'verify-456';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const { service, usersRepository } = createService({
      usersRepository: {
        findOne: jest.fn().mockResolvedValue({
          id: 'user-3',
          emailVerificationTokenHash: tokenHash,
          emailVerificationExpiresAt: new Date(Date.now() + 60_000),
        }),
      },
    });

    const result = await service.verifyEmail(rawToken);

    expect(result.success).toBe(true);
    expect(usersRepository.update).toHaveBeenCalledTimes(1);
    const updatePayload = usersRepository.update.mock.calls[0][1];
    expect(updatePayload.emailVerifiedAt).toBeInstanceOf(Date);
    expect(updatePayload.emailVerificationTokenHash).toBeNull();
  });
});
