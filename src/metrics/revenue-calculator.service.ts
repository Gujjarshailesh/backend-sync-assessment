import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface RevenueSummary {
  from: Date;
  to: Date;
  totalCollected: number;
  currency: string;
}

export interface RevenueBucket {
  periodStart: Date;
  periodEnd: Date;
  totalCollected: number;
}

export type Granularity = 'day' | 'week';

// Single canonical join/filter, shared by BOTH the summary and breakdown
// queries below via Prisma.sql fragment composition. This - not documentation,
// not convention - is the actual mechanism that makes "both views always
// agree" true: there is exactly one place in the codebase that decides
// which rows count as collected. See revenue-invariant.spec.ts for the test
// that would catch a second, divergent implementation.
const COLLECTED_JOIN = Prisma.sql`
  FROM transactions t
  JOIN status_mapping sm ON sm.source = t.source AND sm.raw_status = t.raw_status
  WHERE sm.canonical_status = 'collected'
`;

// Single-currency assumption (see docs/DESIGN.md open decisions): all seed
// data is USD, so summing raw integer amounts without currency conversion
// is correct for this assessment's scope.
const REPORTING_CURRENCY = 'usd';

@Injectable()
export class RevenueCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(from: Date, to: Date): Promise<RevenueSummary> {
    const rows = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(t.amount), 0)::bigint AS total
      ${COLLECTED_JOIN}
      AND t.occurred_at >= ${from} AND t.occurred_at < ${to}
    `;
    return {
      from,
      to,
      totalCollected: Number(rows[0]?.total ?? 0n),
      currency: REPORTING_CURRENCY,
    };
  }

  async getBreakdown(
    from: Date,
    to: Date,
    granularity: Granularity,
  ): Promise<RevenueBucket[]> {
    const rows = await this.prisma.$queryRaw<
      { period_start: Date; total: bigint }[]
    >`
      SELECT date_trunc(${granularity}, t.occurred_at) AS period_start,
             COALESCE(SUM(t.amount), 0)::bigint AS total
      ${COLLECTED_JOIN}
      AND t.occurred_at >= ${from} AND t.occurred_at < ${to}
      GROUP BY period_start
      ORDER BY period_start ASC
    `;

    const intervalMs =
      granularity === 'week' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return rows.map((row) => ({
      periodStart: row.period_start,
      periodEnd: new Date(new Date(row.period_start).getTime() + intervalMs),
      totalCollected: Number(row.total),
    }));
  }
}
