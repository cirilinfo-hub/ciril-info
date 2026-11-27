import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ListQueryDto } from '../../common/http/pagination.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { TldBulkDto, TldDto, TldImportDto, TldPatchDto } from './admin-tlds.dto.js';
import { AdminTldsService } from './admin-tlds.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: the domain price list. */
@ApiTags('admin · domain prices')
@Controller('admin/domains/tlds')
export class AdminTldsController {
  constructor(private readonly svc: AdminTldsService) {}

  @Get() @RequirePlatform('domains:read')
  list(@Query() q: ListQueryDto) { return this.svc.list(q); }

  @Post() @HttpCode(201) @RequirePlatform('domains:write')
  create(@CurrentUser() u: AuthUser, @Body() dto: TldDto, @ReqMeta() meta: RequestMeta) { return this.svc.create(u, dto, meta); }

  /** One markup (percent or rupees) over many endings. Declared before ':id' routes. */
  @Post('bulk-price') @HttpCode(200) @RequirePlatform('domains:write')
  bulk(@CurrentUser() u: AuthUser, @Body() dto: TldBulkDto, @ReqMeta() meta: RequestMeta) { return this.svc.bulk(u, dto, meta); }

  /** Purchase prices pasted from the registrar's price sheet. */
  @Post('import') @HttpCode(200) @RequirePlatform('domains:write')
  import(@CurrentUser() u: AuthUser, @Body() dto: TldImportDto, @ReqMeta() meta: RequestMeta) { return this.svc.import(u, dto, meta); }

  @Patch(':id') @RequirePlatform('domains:write')
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: TldPatchDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(u, id, dto, meta); }
}
