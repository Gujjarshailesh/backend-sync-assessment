/**
 * Envelope wrapping every record an adapter produces. Normalizes SHAPE
 * (field names/types/units) across providers; deliberately does NOT
 * normalize status MEANING (see CanonicalTransaction.rawStatus) - that
 * resolution is deferred to StatusMapping so a new status is a data
 * change, not a code change.
 */
export interface CanonicalEnvelope<T> {
  source: string;
  externalId: string;
  sourceUpdatedAt: Date;
  raw: unknown;
  data: T;
}

export interface CanonicalContact {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  sourceCreatedAt: Date | null;
}

export interface CanonicalCalendarEventAttendee {
  email: string;
  responseStatus: string;
}

export interface CanonicalCalendarEvent {
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  /** Raw provider status (e.g. 'confirmed' | 'cancelled') - untouched. */
  status: string;
  attendees: CanonicalCalendarEventAttendee[];
}

export interface CanonicalTransaction {
  customerRef: string | null;
  /** Integer minor units (cents), never a float. */
  amount: number;
  currency: string;
  /** Untouched provider vocabulary, e.g. 'succeeded' | 'voided'. */
  rawStatus: string;
  occurredAt: Date;
}
