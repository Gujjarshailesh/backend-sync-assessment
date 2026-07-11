import { calendar_v3 } from 'googleapis';
import {
  CanonicalCalendarEvent,
  CanonicalEnvelope,
} from '../../common/interfaces/canonical-entities.interface';
import { MappingError } from '../../common/errors/domain-errors';
import { GOOGLE_CALENDAR_SOURCE } from './calendar.client';

export function mapGoogleCalendarEvent(
  event: calendar_v3.Schema$Event,
  calendarId: string,
): CanonicalEnvelope<CanonicalCalendarEvent> {
  if (!event.id) {
    throw new MappingError(GOOGLE_CALENDAR_SOURCE, 'event is missing an id');
  }

  // Cancelled events returned via showDeleted=true often omit start/end -
  // fall back to "now" rather than failing the whole batch on a tombstone.
  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  const isCancelled = event.status === 'cancelled';
  if ((!start || !end) && !isCancelled) {
    throw new MappingError(
      GOOGLE_CALENDAR_SOURCE,
      `event ${event.id} is missing start/end`,
    );
  }

  return {
    source: GOOGLE_CALENDAR_SOURCE,
    externalId: event.id,
    sourceUpdatedAt: event.updated ? new Date(event.updated) : new Date(),
    raw: event,
    data: {
      calendarId,
      title: event.summary ?? '(no title)',
      description: event.description ?? null,
      location: event.location ?? null,
      startTime: start ? new Date(start) : new Date(),
      endTime: end ? new Date(end) : new Date(),
      status: event.status ?? 'confirmed',
      attendees: (event.attendees ?? [])
        .filter((attendee) => Boolean(attendee.email))
        .map((attendee) => ({
          email: attendee.email as string,
          responseStatus: attendee.responseStatus ?? 'needsAction',
        })),
    },
  };
}
