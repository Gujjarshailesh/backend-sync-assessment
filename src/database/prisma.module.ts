import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global: PrismaService is infrastructure every feature module needs,
 * not a per-feature dependency - same rationale as ConfigModule.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
