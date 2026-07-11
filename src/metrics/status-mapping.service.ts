import { Injectable } from '@nestjs/common';
import { CanonicalStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/**
 * Single lookup point for the allow-list. Not used by RevenueCalculatorService
 * (which resolves "collected" via a SQL join for correctness/performance at
 * scale) - this exists for callers that need a single (source, rawStatus)
 * answer, e.g. tests asserting the allow-list default.
 */
@Injectable()
export class StatusMappingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(source: string, rawStatus: string): Promise<CanonicalStatus> {
    const mapping = await this.prisma.statusMapping.findUnique({
      where: { source_rawStatus: { source, rawStatus } },
    });
    // Unmapped defaults to not_collected - an allow-list, never an
    // exclusion list. A brand-new status from a source never silently
    // counts as revenue until someone explicitly adds it here.
    return mapping?.canonicalStatus ?? CanonicalStatus.not_collected;
  }

  async isCollected(source: string, rawStatus: string): Promise<boolean> {
    return (
      (await this.resolve(source, rawStatus)) === CanonicalStatus.collected
    );
  }
}
