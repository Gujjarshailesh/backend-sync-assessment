import { IsISO8601, IsIn } from 'class-validator';

export class DateRangeQueryDto {
  @IsISO8601()
  from!: string;

  @IsISO8601()
  to!: string;
}

export class BreakdownQueryDto extends DateRangeQueryDto {
  @IsIn(['day', 'week'])
  granularity!: 'day' | 'week';
}
