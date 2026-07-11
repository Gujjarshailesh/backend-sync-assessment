/**
 * A fabricated second "finance system" with its own status vocabulary.
 * One real Stripe test account can't produce enough genuinely different
 * "collected" words (Stripe only ever says succeeded/processing/canceled/
 * requires_*) - this fixture exists purely to exercise multi-vocabulary
 * normalization honestly, per the assignment's actual requirement.
 */
export interface SeedFinanceRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customerRef: string;
  occurredAt: string;
  updatedAt: string;
}

export const SEED_FINANCE_RECORDS: SeedFinanceRecord[] = [
  {
    id: 'sf_1001',
    amount: 4200,
    currency: 'usd',
    status: 'completed',
    customerRef: 'cust_001',
    occurredAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
  },
  {
    id: 'sf_1002',
    amount: 1500,
    currency: 'usd',
    status: 'waiting',
    customerRef: 'cust_002',
    occurredAt: '2026-06-03T09:30:00Z',
    updatedAt: '2026-06-03T09:30:00Z',
  },
  {
    id: 'sf_1003',
    amount: 9999,
    currency: 'usd',
    status: 'completed',
    customerRef: 'cust_003',
    occurredAt: '2026-06-05T14:15:00Z',
    updatedAt: '2026-06-05T14:15:00Z',
  },
  {
    id: 'sf_1004',
    amount: 2500,
    currency: 'usd',
    status: 'voided',
    customerRef: 'cust_001',
    occurredAt: '2026-06-06T11:00:00Z',
    updatedAt: '2026-06-07T08:00:00Z',
  },
  {
    id: 'sf_1005',
    amount: 7300,
    currency: 'usd',
    status: 'reversed',
    customerRef: 'cust_004',
    occurredAt: '2026-06-10T16:45:00Z',
    updatedAt: '2026-06-11T09:00:00Z',
  },
  {
    id: 'sf_1006',
    amount: 6100,
    currency: 'usd',
    status: 'completed',
    customerRef: 'cust_002',
    occurredAt: '2026-06-12T13:20:00Z',
    updatedAt: '2026-06-12T13:20:00Z',
  },
];
