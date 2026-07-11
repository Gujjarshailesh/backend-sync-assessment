import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  AdapterRunnerService,
  RequestedMode,
} from '../src/sync/adapter-runner.service';
import {
  SOURCE_ADAPTERS,
  SourceAdapter,
} from '../src/common/interfaces/source-adapter.interface';

/**
 * Runs one adapter standalone, outside the HTTP server - exactly what lets
 * each provider be executed and verified independently before the
 * orchestrator (which will just loop this same runner over every adapter)
 * exists.
 *
 * Usage: npm run sync:run -- <source> [full|incremental|auto]
 * Sources: google_calendar | hubspot | stripe | seed_finance
 */
async function main(): Promise<void> {
  const [, , source, modeArg] = process.argv;
  const mode = (modeArg as RequestedMode) ?? 'auto';

  if (!source) {
    console.error(
      'Usage: npm run sync:run -- <source> [full|incremental|auto]',
    );
    console.error('Sources: google_calendar | hubspot | stripe | seed_finance');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const adapters = app.get<SourceAdapter[]>(SOURCE_ADAPTERS);
    const adapter = adapters.find(
      (candidate) => candidate.sourceName === source,
    );
    if (!adapter) {
      console.error(
        `Unknown source "${source}". Available: ${adapters.map((candidate) => candidate.sourceName).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }

    const runner = app.get(AdapterRunnerService);
    const outcome = await runner.runStandalone(adapter, mode);
    console.log(JSON.stringify(outcome, null, 2));
    process.exitCode = outcome.status === 'success' ? 0 : 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
