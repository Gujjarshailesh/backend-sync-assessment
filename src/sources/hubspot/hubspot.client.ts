import { Injectable } from '@nestjs/common';
import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts';
import { AppConfigService } from '../../config/app-config.service';
import {
  SourceUnavailableError,
  StaleCursorError,
} from '../../common/errors/domain-errors';
import { withRetry } from '../../common/utils/retry.util';

export const HUBSPOT_SOURCE = 'hubspot';

const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'lifecyclestage',
  'createdate',
  'lastmodifieddate',
];

export interface HubspotPage {
  results: Array<{
    id: string;
    properties: Record<string, string | null>;
    createdAt: string | Date;
    updatedAt: string | Date;
  }>;
  paging?: { next?: { after?: string } };
}

@Injectable()
export class HubspotClient {
  private client: Client | undefined;

  constructor(private readonly config: AppConfigService) {}

  private getClient(): Client {
    const accessToken = this.config.hubspotAccessToken;
    if (!accessToken) {
      throw new SourceUnavailableError(
        HUBSPOT_SOURCE,
        'HUBSPOT_ACCESS_TOKEN not configured',
      );
    }
    if (!this.client) {
      this.client = new Client({ accessToken });
    }
    return this.client;
  }

  /** Full fetch: every contact, paginated. */
  async listAllContacts(after?: string): Promise<HubspotPage> {
    const client = this.getClient();
    try {
      const page = await withRetry(
        () =>
          client.crm.contacts.basicApi.getPage(100, after, CONTACT_PROPERTIES),
        { isRetryable: isTransient },
      );
      return page;
    } catch (error) {
      throw new SourceUnavailableError(HUBSPOT_SOURCE, error);
    }
  }

  /**
   * Incremental fetch: contacts modified since `sinceMs`. A rejected search
   * request (malformed/unusable cursor value) is our stale-cursor signal -
   * HubSpot's cursor here is a plain timestamp, not an opaque token, so it
   * can't expire the way Google's syncToken does, but a corrupted/garbage
   * stored value produces the same class of 400 we treat identically.
   */
  async searchContactsModifiedSince(
    sinceMs: number,
    after?: string,
  ): Promise<HubspotPage> {
    const client = this.getClient();
    try {
      const page = await withRetry(
        () =>
          client.crm.contacts.searchApi.doSearch({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'lastmodifieddate',
                    operator: FilterOperatorEnum.Gt,
                    value: String(sinceMs),
                  },
                ],
              },
            ],
            sorts: ['lastmodifieddate'],
            properties: CONTACT_PROPERTIES,
            limit: 100,
            after,
          }),
        { isRetryable: isTransient },
      );
      return page;
    } catch (error) {
      if (isBadRequest(error)) {
        throw new StaleCursorError(HUBSPOT_SOURCE, error);
      }
      throw new SourceUnavailableError(HUBSPOT_SOURCE, error);
    }
  }
}

interface HubspotLikeError {
  code?: number;
  response?: { status?: number };
}

function statusOf(error: unknown): number | undefined {
  const err = error as HubspotLikeError;
  return err?.code ?? err?.response?.status;
}

function isBadRequest(error: unknown): boolean {
  return statusOf(error) === 400;
}

function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  return status === 429 || (typeof status === 'number' && status >= 500);
}
