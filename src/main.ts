import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // bufferLogs: true holds early boot logs until the pino logger below is
  // ready, so nothing gets lost or falls back to Nest's default console
  // logger before the switch happens.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  // Enables the static admin dashboard (dashboard/) to call this API from a
  // different origin (a different port, or a local file:// page). Open by
  // default (no allowlist) since every endpoint here is read-only or an
  // idempotent trigger with no user-specific auth to leak.
  app.enableCors();
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(AppConfigService);
  await app.listen(config.port);
}
void bootstrap();
