import { CanonicalStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The allow-list of which (source, rawStatus) pairs count as "collected".
 * Anything not listed here defaults to not-collected at the application
 * layer (StatusMappingService) - this is additive, never an exclusion list.
 *
 * Stripe values are the real vocabulary for PaymentIntents. seed_finance is
 * the fabricated second source (task 21) with its own distinct wording, used
 * to genuinely exercise multi-vocabulary normalization - one Stripe test
 * account alone can't produce enough different "collected" words.
 */
const statusMappings: {
  source: string;
  rawStatus: string;
  canonicalStatus: CanonicalStatus;
}[] = [
  // Stripe (PaymentIntent.status)
  {
    source: 'stripe',
    rawStatus: 'succeeded',
    canonicalStatus: CanonicalStatus.collected,
  },
  {
    source: 'stripe',
    rawStatus: 'processing',
    canonicalStatus: CanonicalStatus.not_collected,
  },
  {
    source: 'stripe',
    rawStatus: 'requires_payment_method',
    canonicalStatus: CanonicalStatus.not_collected,
  },
  {
    source: 'stripe',
    rawStatus: 'requires_action',
    canonicalStatus: CanonicalStatus.not_collected,
  },
  {
    source: 'stripe',
    rawStatus: 'canceled',
    canonicalStatus: CanonicalStatus.not_collected,
  },

  // seed-finance (fabricated second vocabulary)
  {
    source: 'seed_finance',
    rawStatus: 'completed',
    canonicalStatus: CanonicalStatus.collected,
  },
  {
    source: 'seed_finance',
    rawStatus: 'waiting',
    canonicalStatus: CanonicalStatus.not_collected,
  },
  {
    source: 'seed_finance',
    rawStatus: 'voided',
    canonicalStatus: CanonicalStatus.not_collected,
  },
  {
    source: 'seed_finance',
    rawStatus: 'reversed',
    canonicalStatus: CanonicalStatus.not_collected,
  },
];

async function main(): Promise<void> {
  for (const mapping of statusMappings) {
    await prisma.statusMapping.upsert({
      where: {
        source_rawStatus: {
          source: mapping.source,
          rawStatus: mapping.rawStatus,
        },
      },
      update: { canonicalStatus: mapping.canonicalStatus },
      create: mapping,
    });
  }
  console.log(`Seeded ${statusMappings.length} status mappings.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
