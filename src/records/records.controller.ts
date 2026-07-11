import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(limit?: string): number {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

@Controller()
export class RecordsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('contacts')
  async contacts(@Query('limit') limit?: string) {
    return this.prisma.contact.findMany({
      take: parseLimit(limit),
      orderBy: { sourceUpdatedAt: 'desc' },
    });
  }

  @Get('calendar-events')
  async calendarEvents(@Query('limit') limit?: string) {
    return this.prisma.calendarEvent.findMany({
      take: parseLimit(limit),
      orderBy: { startTime: 'asc' },
    });
  }

  @Get('transactions')
  async transactions(@Query('limit') limit?: string) {
    return this.prisma.transaction.findMany({
      take: parseLimit(limit),
      orderBy: { occurredAt: 'desc' },
    });
  }

  @Get('audit-log')
  async auditLog(@Query('limit') limit?: string) {
    return this.prisma.auditLog.findMany({
      take: parseLimit(limit),
      orderBy: { createdAt: 'desc' },
    });
  }
}
