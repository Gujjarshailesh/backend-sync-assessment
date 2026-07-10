import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.validation';

/**
 * Global so any feature module can inject AppConfigService without
 * re-importing this module everywhere - config is cross-cutting
 * infrastructure, not a per-feature dependency.
 *
 * Deliberately does NOT export Nest's raw ConfigModule/ConfigService:
 * everything in this app goes through the typed AppConfigService instead,
 * so there's exactly one way to read configuration.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
