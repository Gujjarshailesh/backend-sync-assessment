import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule, PrismaModule, HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
