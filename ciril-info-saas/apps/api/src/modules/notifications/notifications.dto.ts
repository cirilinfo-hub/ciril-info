import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../common/http/pagination.js';

export class NotificationListQuery extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Only unread notices.' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean() unread?: boolean;
}
