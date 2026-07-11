import { calendar_v3 } from 'googleapis';
import { MappingError } from '../../common/errors/domain-errors';
import { mapGoogleCalendarEvent } from './calendar.mapper';

function baseEvent(
  overrides: Partial<calendar_v3.Schema$Event> = {},
): calendar_v3.Schema$Event {
  return {
    id: 'evt_1',
    summary: 'Team sync',
    description: 'Weekly sync',
    location: 'Room 1',
    start: { dateTime: '2026-06-01T10:00:00Z' },
    end: { dateTime: '2026-06-01T11:00:00Z' },
    status: 'confirmed',
    updated: '2026-05-30T00:00:00Z',
    attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
    ...overrides,
  };
}

describe('mapGoogleCalendarEvent', () => {
  it('maps a confirmed event into the canonical shape', () => {
    const envelope = mapGoogleCalendarEvent(baseEvent(), 'primary');

    expect(envelope.source).toBe('google_calendar');
    expect(envelope.externalId).toBe('evt_1');
    expect(envelope.data).toEqual({
      calendarId: 'primary',
      title: 'Team sync',
      description: 'Weekly sync',
      location: 'Room 1',
      startTime: new Date('2026-06-01T10:00:00Z'),
      endTime: new Date('2026-06-01T11:00:00Z'),
      status: 'confirmed',
      attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
    });
  });

  it('throws MappingError when the event has no id', () => {
    expect(() =>
      mapGoogleCalendarEvent(baseEvent({ id: undefined }), 'primary'),
    ).toThrow(MappingError);
  });

  it('does not throw for a cancelled event missing start/end (tombstone)', () => {
    const envelope = mapGoogleCalendarEvent(
      baseEvent({ status: 'cancelled', start: undefined, end: undefined }),
      'primary',
    );
    expect(envelope.data.status).toBe('cancelled');
  });

  it('throws MappingError for a non-cancelled event missing start/end', () => {
    expect(() =>
      mapGoogleCalendarEvent(
        baseEvent({ start: undefined, end: undefined }),
        'primary',
      ),
    ).toThrow(MappingError);
  });

  it('filters out attendees with no email', () => {
    const envelope = mapGoogleCalendarEvent(
      baseEvent({
        attendees: [{ email: 'a@example.com' }, { displayName: 'No email' }],
      }),
      'primary',
    );
    expect(envelope.data.attendees).toEqual([
      { email: 'a@example.com', responseStatus: 'needsAction' },
    ]);
  });
});
