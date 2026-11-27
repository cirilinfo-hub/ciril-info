import { Body, ConflictException, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { ListQueryDto } from '../../common/http/pagination.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { TldBulkDto, TldCostQueryDto, TldDto, TldImportDto, TldPatchDto } from './admin-tlds.dto.js';
import { AdminTldsService } from './admin-tlds.service.js';
import { TldCostSyncService } from './tld-cost-sync.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: the domain price list. */
@ApiTags('admin · domain prices')
@Controller('admin/domains/tlds')
export class AdminTldsController {
  constructor(
    private readonly svc: AdminTldsService,
    private readonly sync: TldCostSyncService,
  ) {}

  /** Whether purchase prices come from the registrar every day, and how the last update went. */
  @Get('price-sync') @RequirePlatform('domains:read')
  async priceSync() { return { ...this.sync.status(), lastRun: await this.sync.lastRun() }; }

  /** Updates the purchase prices from the registrar now (and the selling prices of endings on a markup). */
  @Post('price-sync') @HttpCode(200) @Throttle({ default: { limit: 6, ttl: 3_600_000 } }) @RequirePlatform('domains:write')
  async syncNow(@CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    const r = await this.sync.run(u.id, meta);
    if (r.status === 'skipped') throw new ConflictException({ code: 'NO_REGISTRAR_PRICES', message: 'The connected registrar does not publish its prices, so there is nothing to update from.' });
    return r;
  }

  @Get() @RequirePlatform('domains:read')
  list(@Query() q: ListQueryDto) { return this.svc.list(q); }

  /** What the connected registrar charges us for these endings, ready for the import. */
  @Get('registrar-costs') @RequirePlatform('domains:write')
  registrarCosts(@Query() q: TldCostQueryDto) { return this.svc.registrarCosts(q.tlds); }

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
