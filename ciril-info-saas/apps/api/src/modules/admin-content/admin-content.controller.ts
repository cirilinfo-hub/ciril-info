import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ListQueryDto } from '../../common/http/pagination.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import {
  FaqDto, FaqListQuery, FaqPatchDto, InquiryListQuery, InquiryStatusDto, PlanDto, PlanFeaturesDto, PlanPatchDto, PriceDto, ProductDto,
  ProductPatchDto, ProjectDto, ProjectPatchDto, TestimonialDto, TestimonialPatchDto,
} from './admin-content.dto.js';
import { AdminContentService } from './admin-content.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: everything the public website shows. Every write is permission-checked and audited. */
@ApiTags('admin · website content')
@Controller('admin')
export class AdminContentController {
  constructor(private readonly svc: AdminContentService) {}

  // testimonials
  @Get('content/testimonials') @RequirePlatform('content:read')
  testimonials(@Query() q: ListQueryDto) { return this.svc.listTestimonials(q); }
  @Post('content/testimonials') @HttpCode(201) @RequirePlatform('content:write')
  createTestimonial(@CurrentUser() u: AuthUser, @Body() dto: TestimonialDto, @ReqMeta() m: RequestMeta) { return this.svc.createTestimonial(u, dto, m); }
  @Patch('content/testimonials/:id') @RequirePlatform('content:write')
  updateTestimonial(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: TestimonialPatchDto, @ReqMeta() m: RequestMeta) { return this.svc.updateTestimonial(u, id, dto, m); }
  @Delete('content/testimonials/:id') @HttpCode(204) @RequirePlatform('content:write')
  async deleteTestimonial(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { await this.svc.deleteTestimonial(u, id, m); }

  // FAQs
  @Get('content/faqs') @RequirePlatform('content:read')
  faqs(@Query() q: FaqListQuery) { return this.svc.listFaqs(q); }
  @Post('content/faqs') @HttpCode(201) @RequirePlatform('content:write')
  createFaq(@CurrentUser() u: AuthUser, @Body() dto: FaqDto, @ReqMeta() m: RequestMeta) { return this.svc.createFaq(u, dto, m); }
  @Patch('content/faqs/:id') @RequirePlatform('content:write')
  updateFaq(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: FaqPatchDto, @ReqMeta() m: RequestMeta) { return this.svc.updateFaq(u, id, dto, m); }
  @Delete('content/faqs/:id') @HttpCode(204) @RequirePlatform('content:write')
  async deleteFaq(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { await this.svc.deleteFaq(u, id, m); }

  // projects
  @Get('content/projects') @RequirePlatform('content:read')
  projects(@Query() q: ListQueryDto) { return this.svc.listProjects(q); }
  @Post('content/projects') @HttpCode(201) @RequirePlatform('content:write')
  createProject(@CurrentUser() u: AuthUser, @Body() dto: ProjectDto, @ReqMeta() m: RequestMeta) { return this.svc.createProject(u, dto, m); }
  @Patch('content/projects/:id') @RequirePlatform('content:write')
  updateProject(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ProjectPatchDto, @ReqMeta() m: RequestMeta) { return this.svc.updateProject(u, id, dto, m); }
  @Delete('content/projects/:id') @HttpCode(204) @RequirePlatform('content:write')
  async deleteProject(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { await this.svc.deleteProject(u, id, m); }

  // catalogue
  @Get('catalog/categories') @RequirePlatform('products:read')
  categories() { return this.svc.categories(); }
  @Get('catalog/products') @RequirePlatform('products:read')
  products() { return this.svc.listProducts(); }
  @Post('catalog/products') @HttpCode(201) @RequirePlatform('products:write')
  createProduct(@CurrentUser() u: AuthUser, @Body() dto: ProductDto, @ReqMeta() m: RequestMeta) { return this.svc.createProduct(u, dto, m); }
  @Patch('catalog/products/:id') @HttpCode(204) @RequirePlatform('products:write')
  async updateProduct(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ProductPatchDto, @ReqMeta() m: RequestMeta) { await this.svc.updateProduct(u, id, dto, m); }
  @Post('catalog/products/:id/plans') @HttpCode(201) @RequirePlatform('products:write')
  createPlan(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PlanDto, @ReqMeta() m: RequestMeta) { return this.svc.createPlan(u, id, dto, m); }
  @Patch('catalog/plans/:id') @HttpCode(204) @RequirePlatform('products:write')
  async updatePlan(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PlanPatchDto, @ReqMeta() m: RequestMeta) { await this.svc.updatePlan(u, id, dto, m); }
  @Put('catalog/plans/:id/features') @HttpCode(204) @RequirePlatform('products:write')
  async setFeatures(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PlanFeaturesDto, @ReqMeta() m: RequestMeta) { await this.svc.setFeatures(u, id, dto.features, m); }
  @Post('catalog/plans/:id/prices') @HttpCode(201) @RequirePlatform('pricing:write')
  addPrice(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PriceDto, @ReqMeta() m: RequestMeta) { return this.svc.addPrice(u, id, dto, m); }

  // company profile, claims, legal pages
  @Get('settings/company') @RequirePlatform('content:read')
  company() { return this.svc.getCompany(); }
  @Put('settings/company') @RequirePlatform('content:write')
  setCompany(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>, @ReqMeta() m: RequestMeta) { return this.svc.setCompany(u, body, m); }
  @Get('settings/claims') @RequirePlatform('content:read')
  claims() { return this.svc.getClaims(); }
  @Put('settings/claims') @RequirePlatform('content:write')
  setClaims(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>, @ReqMeta() m: RequestMeta) { return this.svc.setClaims(u, body, m); }
  @Get('settings/legal') @RequirePlatform('content:read')
  legalList() { return this.svc.listLegal(); }
  @Get('settings/legal/:slug') @RequirePlatform('content:read')
  legal(@Param('slug') slug: string) { return this.svc.getLegal(slug); }
  @Put('settings/legal/:slug') @RequirePlatform('content:write')
  setLegal(@CurrentUser() u: AuthUser, @Param('slug') slug: string, @Body() body: Record<string, unknown>, @ReqMeta() m: RequestMeta) { return this.svc.setLegal(u, slug, body, m); }

  // contact enquiries
  @Get('inquiries') @RequirePlatform('inquiries:read')
  inquiries(@Query() q: InquiryListQuery) { return this.svc.listInquiries(q); }
  @Patch('inquiries/:id') @HttpCode(204) @RequirePlatform('inquiries:write')
  async inquiryStatus(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: InquiryStatusDto, @ReqMeta() m: RequestMeta) { await this.svc.setInquiryStatus(u, id, dto.status, m); }
}
