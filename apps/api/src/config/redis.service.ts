import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = true;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisEnabledValue = (this.configService.get<string>('REDIS_ENABLED') ?? 'true').toLowerCase();
    const redisUrl = this.configService.get<string>('REDIS_URL')?.trim() || '';

    this.enabled = redisEnabledValue === 'true' && redisUrl.length > 0;
    if (!this.enabled) {
      this.logger.warn('Redis disabled. Set REDIS_ENABLED=true and REDIS_URL to enable it.');
      return;
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    await this.client.ping();
    this.logger.log(`Redis connected (${redisUrl})`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async ping(): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    if (!this.client) {
      throw new Error('El cliente de Redis no esta inicializado');
    }
    return this.client.ping();
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
