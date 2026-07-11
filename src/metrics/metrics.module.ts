import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { RevenueCalculatorService } from './revenue-calculator.service';
import { StatusMappingService } from './status-mapping.service';

@Module({
  controllers: [MetricsController],
  providers: [RevenueCalculatorService, StatusMappingService],
  exports: [RevenueCalculatorService, StatusMappingService],
})
export class MetricsModule {}
