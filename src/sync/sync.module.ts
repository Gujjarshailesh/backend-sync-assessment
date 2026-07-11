import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { AdapterRunnerService } from './adapter-runner.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { SyncController } from './sync.controller';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
  imports: [SourcesModule],
  controllers: [SyncController, StripeWebhookController],
  providers: [AdapterRunnerService, SyncOrchestratorService],
  exports: [AdapterRunnerService, SyncOrchestratorService, SourcesModule],
})
export class SyncModule {}
