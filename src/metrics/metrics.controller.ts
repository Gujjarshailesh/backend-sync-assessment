import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { RevenueCalculatorService } from './revenue-calculator.service';
import { StatusMappingService } from './status-mapping.service';
import {
  BreakdownQueryDto,
  DateRangeQueryDto,
} from './dto/date-range-query.dto';

const MAX_RANGE_MS = 3 * 365 * 24 * 60 * 60 * 1000; // ~3 years - generous, but bounded

@Controller('metrics/revenue')
export class MetricsController {
  constructor(
    private readonly calculator: RevenueCalculatorService,
    private readonly statusMapping: StatusMappingService,
  ) {}

  @Get('status-mapping')
  async statusMappings() {
    return this.statusMapping.listAll();
  }

  @Get('summary')
  async summary(@Query() query: DateRangeQueryDto) {
    const { from, to } = this.parseRange(query.from, query.to);
    return this.calculator.getSummary(from, to);
  }

  @Get('breakdown')
  async breakdown(@Query() query: BreakdownQueryDto) {
    const { from, to } = this.parseRange(query.from, query.to);
    const buckets = await this.calculator.getBreakdown(
      from,
      to,
      query.granularity,
    );
    return { from, to, granularity: query.granularity, buckets };
  }

  private parseRange(fromStr: string, toStr: string): { from: Date; to: Date } {
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('`to` must be after `from`');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException('Date range too large (maximum ~3 years)');
    }
    return { from, to };
  }
}
