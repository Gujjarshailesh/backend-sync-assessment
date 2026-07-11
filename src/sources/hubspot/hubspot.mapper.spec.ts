import { MappingError } from '../../common/errors/domain-errors';
import { mapHubspotContact } from './hubspot.mapper';
import { HubspotPage } from './hubspot.client';

type HubspotContactRecord = HubspotPage['results'][number];

function baseContact(
  overrides: Partial<HubspotContactRecord> = {},
): HubspotContactRecord {
  return {
    id: '12345',
    properties: {
      email: 'jane@example.com',
      firstname: 'Jane',
      lastname: 'Doe',
      phone: '555-0100',
      lifecyclestage: 'lead',
      createdate: '2026-01-01T00:00:00.000Z',
      lastmodifieddate: '2026-06-01T00:00:00.000Z',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapHubspotContact', () => {
  it('maps a full contact into the canonical shape', () => {
    const envelope = mapHubspotContact(baseContact());

    expect(envelope.source).toBe('hubspot');
    expect(envelope.externalId).toBe('12345');
    expect(envelope.sourceUpdatedAt).toEqual(
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect(envelope.data).toEqual({
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '555-0100',
      lifecycleStage: 'lead',
      sourceCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('throws MappingError when the contact has no id', () => {
    expect(() => mapHubspotContact(baseContact({ id: '' }))).toThrow(
      MappingError,
    );
  });

  it('falls back to null for missing optional properties', () => {
    const envelope = mapHubspotContact(baseContact({ properties: {} }));
    expect(envelope.data.email).toBeNull();
    expect(envelope.data.firstName).toBeNull();
    expect(envelope.data.lifecycleStage).toBeNull();
  });

  it('falls back to the object-level timestamps when property timestamps are absent', () => {
    const envelope = mapHubspotContact(
      baseContact({
        properties: { email: 'x@example.com' },
      }),
    );
    // no lastmodifieddate in properties -> falls back to contact.updatedAt
    expect(envelope.sourceUpdatedAt).toEqual(
      new Date('2026-06-01T00:00:00.000Z'),
    );
  });
});
