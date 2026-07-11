import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { TriggerSyncDto } from './dto/trigger-sync.dto';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly orchestrator: SyncOrchestratorService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('trigger')
  async trigger(@Body() dto: TriggerSyncDto) {
    return this.orchestrator.runAll({
      mode: dto.mode,
      sourceFilter: dto.source,
    });
  }

  @Get('runs')
  async listRuns(@Query('limit') limit?: string) {
    const take = limit ? Math.min(Number(limit), 100) : 20;
    return this.prisma.syncRun.findMany({
      take,
      orderBy: { startedAt: 'desc' },
      include: { sources: true },
    });
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    const run = await this.prisma.syncRun.findUnique({
      where: { id },
      include: { sources: true },
    });
    if (!run) {
      throw new NotFoundException(`Sync run "${id}" not found`);
    }
    return run;
  }

  @Get('state')
  async getState() {
    return this.prisma.syncState.findMany({ orderBy: { source: 'asc' } });
  }
}
