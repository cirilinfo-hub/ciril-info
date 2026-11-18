import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches } from 'class-validator';
import type { RequestMeta } from '../auth/auth.types.js';
import { Public, ReqMeta } from '../auth/decorators.js';
import { CreateInquiryDto } from './public.dto.js';
import { PublicService } from './public.service.js';

class PlacementQuery {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,40}$/) placement?: string;
}
class TopicQuery {
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,64}$/) topic?: string;
}

/** Unauthenticated website content. Nothing here returns tenant or customer data. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('site')
  site() {
    return this.svc.site();
  }

  @Get('catalog')
  catalog() {
    return this.svc.catalog();
  }

  @Get('testimonials')
  testimonials(@Query() q: PlacementQuery) {
    return this.svc.testimonials(q.placement);
  }

  @Get('faqs')
  faqs(@Query() q: TopicQuery) {
    return this.svc.faqs(q.topic);
  }

  @Get('projects')
  projects() {
    return this.svc.projects();
  }

  @Get('legal/:slug')
  legal(@Param('slug') slug: string) {
    return this.svc.legal(slug);
  }

  @Post('inquiries')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  inquire(@Body() dto: CreateInquiryDto, @ReqMeta() meta: RequestMeta) {
    return this.svc.createInquiry(dto, meta.ip);
  }
}
