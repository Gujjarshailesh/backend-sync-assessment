import { Injectable } from '@nestjs/common';
import { calendar_v3, google } from 'googleapis';
import { AppConfigService } from '../../config/app-config.service';
import {
  SourceUnavailableError,
  StaleCursorError,
} from '../../common/errors/domain-errors';
import { withRetry } from '../../common/utils/retry.util';

export const GOOGLE_CALENDAR_SOURCE = 'google_calendar';

export interface ListEventsParams {
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
}

/**
 * Thin wrapper over the googleapis Calendar client. Auth is a service
 * account (not interactive OAuth): the target calendar must be shared with
 * the service account's email (Calendar -> Settings -> Share with specific
 * people), which works for any Google account, not just Workspace - no
 * consent screen or refresh-token management needed for a headless server.
 */
@Injectable()
export class GoogleCalendarClient {
  private client: calendar_v3.Calendar | undefined;

  constructor(private readonly config: AppConfigService) {}

  private getClient(): calendar_v3.Calendar {
    const email = this.config.googleServiceAccountEmail;
    const key = this.config.googleServiceAccountPrivateKey;
    if (!email || !key) {
      throw new SourceUnavailableError(
        GOOGLE_CALENDAR_SOURCE,
        'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not configured',
      );
    }
    if (!this.client) {
      const auth = new google.auth.JWT({
        email,
        key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      this.client = google.calendar({ version: 'v3', auth });
    }
    return this.client;
  }

  private getCalendarId(): string {
    const calendarId = this.config.googleCalendarId;
    if (!calendarId) {
      throw new SourceUnavailableError(
        GOOGLE_CALENDAR_SOURCE,
        'GOOGLE_CALENDAR_ID not configured',
      );
    }
    return calendarId;
  }

  async listEvents(
    params: ListEventsParams,
  ): Promise<calendar_v3.Schema$Events> {
    const client = this.getClient();
    const calendarId = this.getCalendarId();
    try {
      return await withRetry(
        async () => {
          const res = await client.events.list({
            calendarId,
            syncToken: params.syncToken,
            timeMin: params.timeMin,
            timeMax: params.timeMax,
            pageToken: params.pageToken,
            singleEvents: true,
            showDeleted: true,
            maxResults: 250,
          });
          return res.data;
        },
        { isRetryable: (error) => isTransient(error) },
      );
    } catch (error) {
      if (isGone(error)) {
        // Google's documented signal that a syncToken has expired.
        throw new StaleCursorError(GOOGLE_CALENDAR_SOURCE, error);
      }
      throw new SourceUnavailableError(GOOGLE_CALENDAR_SOURCE, error);
    }
  }
}

interface GaxiosLikeError {
  code?: number | string;
  response?: { status?: number };
}

function statusOf(error: unknown): number | undefined {
  const err = error as GaxiosLikeError;
  const code = err?.code;
  const status = err?.response?.status;
  const numericCode = typeof code === 'string' ? Number(code) : code;
  return status ?? numericCode;
}

function isGone(error: unknown): boolean {
  return statusOf(error) === 410;
}

function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  return status === 429 || (typeof status === 'number' && status >= 500);
}
