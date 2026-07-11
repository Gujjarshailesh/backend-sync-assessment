import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

export interface HealthStatus {
  status: 'ok';
  env: string;
  uptimeSeconds: number;
  db: 'ok';
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const db = await this.checkDatabase();
    return {
      status: 'ok',
      env: this.appConfig.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      db,
    };
  }

  private async checkDatabase(): Promise<'ok'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`Database unavailable: ${message}`);
    }
  }
}
