import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

export interface HealthStatus {
  status: 'ok';
  env: string;
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  check(): HealthStatus {
    return {
      status: 'ok',
      env: this.appConfig.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
