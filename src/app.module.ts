import { Module } from '@nestjs/common';
import { join } from 'path';
import { LoggerModule } from 'nestjs-pino';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { SyncModule } from './sync/sync.module';
import { MetricsModule } from './metrics/metrics.module';
import { RecordsModule } from './records/records.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      // dist/app.module.js -> ../public, i.e. the project-root `public/`
      // directory - keeps the static dashboard and the API on one domain.
      rootPath: join(__dirname, '..', 'public'),
      exclude: [
        '/health*',
        '/sync*',
        '/metrics*',
        '/contacts*',
        '/calendar-events*',
        '/transactions*',
        '/audit-log*',
        '/webhooks*',
      ],
    }),
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
    RecordsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
