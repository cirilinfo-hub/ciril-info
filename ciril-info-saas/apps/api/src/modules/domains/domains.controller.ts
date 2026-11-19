import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../auth/decorators.js';
import { DomainsService } from './domains.service.js';

class SearchQuery {
  @IsString() @MinLength(1) @MaxLength(253) q!: string;
}

/** Unauthenticated domain search for the website. It returns prices and availability, nothing about customers. */
@ApiTags('public · domains')
@Public()
@Controller('public/domains')
export class DomainsController {
  constructor(private readonly svc: DomainsService) {}

  @Get('tlds')
  tlds() {
    return this.svc.tlds();
  }

  /** Each search asks the registrar about every ending, so the limit is tighter than for ordinary pages. */
  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@Query() q: SearchQuery) {
    return this.svc.search(q.q);
  }
}
