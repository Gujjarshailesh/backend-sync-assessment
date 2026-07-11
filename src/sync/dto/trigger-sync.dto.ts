import { IsIn, IsOptional, IsString } from 'class-validator';

export class TriggerSyncDto {
  /** Omit to run every registered source. */
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsIn(['auto', 'full', 'incremental'])
  mode?: 'auto' | 'full' | 'incremental';
}
