import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../config/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get('health')
  async getHealth() {
    try {
      await this.dataSource.query('SELECT 1');
      const redisPing = await this.redisService.ping();
      const redisStatus = !this.redisService.isEnabled()
        ? 'disabled'
        : redisPing === 'PONG'
          ? 'up'
          : 'unknown';

      return {
        status: 'ok',
        services: {
          postgres: 'up',
          redis: redisStatus,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        message: 'Fallo la verificacion de salud',
      });
    }
  }
}
