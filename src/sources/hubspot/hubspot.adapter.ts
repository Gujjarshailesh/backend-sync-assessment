import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CanonicalContact,
  CanonicalEnvelope,
} from '../../common/interfaces/canonical-entities.interface';
import {
  CursorKind,
  EntityType,
  FetchResult,
  PersistOutcome,
  SourceAdapter,
} from '../../common/interfaces/source-adapter.interface';
import { HubspotClient, HubspotPage, HUBSPOT_SOURCE } from './hubspot.client';
import { mapHubspotContact } from './hubspot.mapper';

@Injectable()
export class HubspotAdapter implements SourceAdapter<CanonicalContact> {
  readonly sourceName = HUBSPOT_SOURCE;
  readonly entityType: EntityType = 'contact';
  readonly cursorKind: CursorKind = 'timestamp';

  constructor(
    private readonly client: HubspotClient,
    private readonly prisma: PrismaService,
  ) {}

  async fetchFull(): Promise<FetchResult<CanonicalContact>> {
    const envelopes: CanonicalEnvelope<CanonicalContact>[] = [];
    let after: string | undefined;

    do {
      const page: HubspotPage = await this.client.listAllContacts(after);
      for (const contact of page.results) {
        envelopes.push(mapHubspotContact(contact));
      }
      after = page.paging?.next?.after;
    } while (after);

    return { envelopes, nextCursor: this.nextCursorFrom(envelopes) };
  }

  async fetchIncremental(
    cursor: string,
  ): Promise<FetchResult<CanonicalContact>> {
    const sinceMs = Number(cursor);
    const envelopes: CanonicalEnvelope<CanonicalContact>[] = [];
    let after: string | undefined;

    do {
      const page: HubspotPage = await this.client.searchContactsModifiedSince(
        sinceMs,
        after,
      );
      for (const contact of page.results) {
        envelopes.push(mapHubspotContact(contact));
      }
      after = page.paging?.next?.after;
    } while (after);

    const newCursor = this.nextCursorFrom(envelopes);
    return { envelopes, nextCursor: newCursor ?? cursor };
  }

  private nextCursorFrom(
    envelopes: CanonicalEnvelope<CanonicalContact>[],
  ): string | null {
    if (envelopes.length === 0) return null;
    const maxMs = Math.max(
      ...envelopes.map((e) => e.sourceUpdatedAt.getTime()),
    );
    return String(maxMs);
  }

  async persist(
    envelope: CanonicalEnvelope<CanonicalContact>,
  ): Promise<PersistOutcome> {
    const where = {
      source_externalId: {
        source: envelope.source,
        externalId: envelope.externalId,
      },
    };
    const existing = await this.prisma.contact.findUnique({
      where,
      select: { id: true },
    });

    const fields = {
      email: envelope.data.email,
      firstName: envelope.data.firstName,
      lastName: envelope.data.lastName,
      phone: envelope.data.phone,
      lifecycleStage: envelope.data.lifecycleStage,
      sourceCreatedAt: envelope.data.sourceCreatedAt,
      sourceUpdatedAt: envelope.sourceUpdatedAt,
      rawPayload: envelope.raw as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

    await this.prisma.contact.upsert({
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
