import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type CounterWindow = {
  timestamps: number[];
};

@Injectable()
export class AuthRateLimitService {
  private readonly windows = new Map<string, CounterWindow>();
  private readonly loginLimit: number;
  private readonly loginWindowMs: number;
  private readonly refreshLimit: number;
  private readonly refreshWindowMs: number;

  constructor(private readonly configService: ConfigService) {
    this.loginLimit = this.parseNumberConfig('AUTH_RATE_LIMIT_LOGIN_MAX', 10);
    this.loginWindowMs = this.parseNumberConfig('AUTH_RATE_LIMIT_LOGIN_WINDOW_MS', 60_000);
    this.refreshLimit = this.parseNumberConfig('AUTH_RATE_LIMIT_REFRESH_MAX', 30);
    this.refreshWindowMs = this.parseNumberConfig('AUTH_RATE_LIMIT_REFRESH_WINDOW_MS', 60_000);
  }

  assertLoginAllowed(clientIp: string): void {
    this.assertWithinLimit(`login:${clientIp}`, this.loginLimit, this.loginWindowMs);
  }

  assertRefreshAllowed(clientIp: string): void {
    this.assertWithinLimit(`refresh:${clientIp}`, this.refreshLimit, this.refreshWindowMs);
  }

  private assertWithinLimit(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const windowData = this.windows.get(key) ?? { timestamps: [] };
    windowData.timestamps = windowData.timestamps.filter((timestamp) => now - timestamp < windowMs);

    if (windowData.timestamps.length >= limit) {
      throw new HttpException('Demasiados intentos de autenticacion. Intentalo mas tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }

    windowData.timestamps.push(now);
    this.windows.set(key, windowData);
  }

  private parseNumberConfig(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  }
}
