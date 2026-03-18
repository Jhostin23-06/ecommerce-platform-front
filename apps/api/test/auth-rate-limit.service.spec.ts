import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRateLimitService } from '../src/modules/auth/auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  it('allows requests within configured limit', () => {
    const config = new ConfigService({
      AUTH_RATE_LIMIT_LOGIN_MAX: '2',
      AUTH_RATE_LIMIT_LOGIN_WINDOW_MS: '60000',
    });
    const service = new AuthRateLimitService(config);

    expect(() => service.assertLoginAllowed('127.0.0.1')).not.toThrow();
    expect(() => service.assertLoginAllowed('127.0.0.1')).not.toThrow();
  });

  it('throws 429 when limit is exceeded', () => {
    const config = new ConfigService({
      AUTH_RATE_LIMIT_LOGIN_MAX: '1',
      AUTH_RATE_LIMIT_LOGIN_WINDOW_MS: '60000',
    });
    const service = new AuthRateLimitService(config);

    service.assertLoginAllowed('127.0.0.1');

    try {
      service.assertLoginAllowed('127.0.0.1');
      fail('Expected rate limit exception');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });
});
