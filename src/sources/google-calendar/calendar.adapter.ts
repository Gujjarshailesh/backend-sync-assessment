import { Injectable } from '@nestjs/common';
import { calendar_v3 } from 'googleapis';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  CanonicalCalendarEvent,
  CanonicalEnvelope,
} from '../../common/interfaces/canonical-entities.interface';
import {
  CursorKind,
  EntityType,
  FetchResult,
  PersistOutcome,
  SourceAdapter,
} from '../../common/interfaces/source-adapter.interface';
import {
  GoogleCalendarClient,
  GOOGLE_CALENDAR_SOURCE,
} from './calendar.client';
import { mapGoogleCalendarEvent } from './calendar.mapper';
import { Prisma } from '@prisma/client';

/**
 * Full fetch is bounded to a rolling window rather than "all time" - Google
 * Calendar accounts can span years of history that we don't need to seed.
 */
const FULL_FETCH_PAST_DAYS = 90;
const FULL_FETCH_FUTURE_DAYS = 365;

@Injectable()
export class GoogleCalendarAdapter implements SourceAdapter<CanonicalCalendarEvent> {
  readonly sourceName = GOOGLE_CALENDAR_SOURCE;
  readonly entityType: EntityType = 'calendar_event';
  readonly cursorKind: CursorKind = 'token';

  constructor(
    private readonly client: GoogleCalendarClient,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async fetchFull(): Promise<FetchResult<CanonicalCalendarEvent>> {
    const calendarId = this.config.googleCalendarId ?? '';
    const now = Date.now();
    const timeMin = new Date(
      now - FULL_FETCH_PAST_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const timeMax = new Date(
      now + FULL_FETCH_FUTURE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    return this.paginate(calendarId, { timeMin, timeMax });
  }

  async fetchIncremental(
    cursor: string,
  ): Promise<FetchResult<CanonicalCalendarEvent>> {
    const calendarId = this.config.googleCalendarId ?? '';
    return this.paginate(calendarId, { syncToken: cursor });
  }

  private async paginate(
    calendarId: string,
    baseParams: { syncToken?: string; timeMin?: string; timeMax?: string },
  ): Promise<FetchResult<CanonicalCalendarEvent>> {
    const envelopes: CanonicalEnvelope<CanonicalCalendarEvent>[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const page: calendar_v3.Schema$Events = await this.client.listEvents({
        ...baseParams,
        pageToken,
      });
      for (const event of page.items ?? []) {
        envelopes.push(mapGoogleCalendarEvent(event, calendarId));
      }
      pageToken = page.nextPageToken ?? undefined;
      if (page.nextSyncToken) {
        nextSyncToken = page.nextSyncToken;
      }
    } while (pageToken);

    return { envelopes, nextCursor: nextSyncToken };
  }

  async persist(
    envelope: CanonicalEnvelope<CanonicalCalendarEvent>,
  ): Promise<PersistOutcome> {
    const where = {
      source_externalId: {
        source: envelope.source,
        externalId: envelope.externalId,
      },
    };
    const existing = await this.prisma.calendarEvent.findUnique({
      where,
      select: { id: true },
    });
    const isCancelled = envelope.data.status === 'cancelled';

    const fields = {
      calendarId: envelope.data.calendarId,
      title: envelope.data.title,
      description: envelope.data.description,
      location: envelope.data.location,
      startTime: envelope.data.startTime,
      endTime: envelope.data.endTime,
      status: envelope.data.status,
      attendees: envelope.data.attendees as unknown as Prisma.InputJsonValue,
      sourceUpdatedAt: envelope.sourceUpdatedAt,
      rawPayload: envelope.raw as Prisma.InputJsonValue,
      syncedAt: new Date(),
      deletedAt: isCancelled ? new Date() : null,
    };

    await this.prisma.calendarEvent.upsert({
      where,
      create: {
        source: envelope.source,
        externalId: envelope.externalId,
        ...fields,
      },
      update: fields,
    });

    return {
      action: existing ? 'updated' : 'created',
      externalId: envelope.externalId,
    };
  }
}
