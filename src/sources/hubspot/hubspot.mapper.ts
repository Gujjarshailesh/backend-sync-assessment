import {
  CanonicalContact,
  CanonicalEnvelope,
} from '../../common/interfaces/canonical-entities.interface';
import { MappingError } from '../../common/errors/domain-errors';
import { HUBSPOT_SOURCE, HubspotPage } from './hubspot.client';

type HubspotContactRecord = HubspotPage['results'][number];

export function mapHubspotContact(
  contact: HubspotContactRecord,
): CanonicalEnvelope<CanonicalContact> {
  if (!contact.id) {
    throw new MappingError(HUBSPOT_SOURCE, 'contact is missing an id');
  }
  const props = contact.properties ?? {};

  return {
    source: HUBSPOT_SOURCE,
    externalId: contact.id,
    sourceUpdatedAt: props.lastmodifieddate
      ? new Date(props.lastmodifieddate)
      : new Date(contact.updatedAt),
    raw: contact,
    data: {
      email: props.email ?? null,
      firstName: props.firstname ?? null,
      lastName: props.lastname ?? null,
      phone: props.phone ?? null,
      lifecycleStage: props.lifecyclestage ?? null,
      sourceCreatedAt: props.createdate
        ? new Date(props.createdate)
        : new Date(contact.createdAt),
    },
  };
}
