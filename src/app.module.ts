import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { SyncModule } from './sync/sync.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        // Don't log full request/response bodies for the webhook route -
        // it's the one endpoint that legitimately carries external payloads.
        redact: [
          'req.headers.authorization',
          'req.headers["stripe-signature"]',
        ],
      },
    }),
    ConfigModule,
    PrismaModule,
    HealthModule,
    SyncModule,
    MetricsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
