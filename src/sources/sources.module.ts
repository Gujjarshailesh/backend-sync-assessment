import { Module } from '@nestjs/common';
import {
  SOURCE_ADAPTERS,
  SourceAdapter,
} from '../common/interfaces/source-adapter.interface';
import { GoogleCalendarClient } from './google-calendar/calendar.client';
import { GoogleCalendarAdapter } from './google-calendar/calendar.adapter';
import { HubspotClient } from './hubspot/hubspot.client';
import { HubspotAdapter } from './hubspot/hubspot.adapter';
import { StripeClient } from './stripe/stripe.client';
import { StripeAdapter } from './stripe/stripe.adapter';
import { SeedFinanceAdapter } from './seed-finance/seed-finance.adapter';

/**
 * Registers every provider adapter behind the SOURCE_ADAPTERS token as a
 * plain array, so the sync runner (and later the orchestrator) can iterate
 * all registered sources without importing a single concrete adapter class.
 * Adding a fifth provider later means adding it to this array - nothing
 * else in the sync layer changes.
 */
@Module({
  providers: [
    GoogleCalendarClient,
    GoogleCalendarAdapter,
    HubspotClient,
    HubspotAdapter,
    StripeClient,
    StripeAdapter,
    SeedFinanceAdapter,
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (
        calendar: GoogleCalendarAdapter,
        hubspot: HubspotAdapter,
        stripe: StripeAdapter,
        seedFinance: SeedFinanceAdapter,
      ): SourceAdapter[] => [calendar, hubspot, stripe, seedFinance],
      inject: [
        GoogleCalendarAdapter,
        HubspotAdapter,
        StripeAdapter,
        SeedFinanceAdapter,
      ],
    },
  ],
  exports: [
    SOURCE_ADAPTERS,
    GoogleCalendarAdapter,
    HubspotAdapter,
    StripeAdapter,
    SeedFinanceAdapter,
    // StripeClient exported too: the webhook controller needs it directly
    // for signature verification, separate from the adapter's fetch/persist
    // methods.
    StripeClient,
  ],
})
export class SourcesModule {}
