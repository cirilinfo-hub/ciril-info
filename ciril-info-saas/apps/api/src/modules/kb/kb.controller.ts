import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, Public, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { KbArticleDto, KbArticleListQuery, KbArticlePatchDto, KbCategoryDto, KbCategoryPatchDto, KbPublicQuery } from './kb.dto.js';
import { KbService } from './kb.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

class SlugParam {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
}

/** Admin portal: write and publish help centre articles. */
@ApiTags('admin · help centre')
@Controller('admin/kb')
export class KbAdminController {
  constructor(private readonly svc: KbService) {}

  @Get('categories') @RequirePlatform('kb:write')
  categories() { return this.svc.listCategories(); }
  @Post('categories') @HttpCode(201) @RequirePlatform('kb:write')
  createCategory(@CurrentUser() u: AuthUser, @Body() dto: KbCategoryDto, @ReqMeta() m: RequestMeta) { return this.svc.createCategory(u, dto, m); }
  @Patch('categories/:id') @RequirePlatform('kb:write')
  updateCategory(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: KbCategoryPatchDto, @ReqMeta() m: RequestMeta) { return this.svc.updateCategory(u, id, dto, m); }
  @Delete('categories/:id') @HttpCode(204) @RequirePlatform('kb:write')
  async deleteCategory(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { await this.svc.deleteCategory(u, id, m); }

  @Get('articles') @RequirePlatform('kb:write')
  articles(@Query() q: KbArticleListQuery) { return this.svc.listArticles(q); }
  @Get('articles/:id') @RequirePlatform('kb:write')
  article(@Param('id', uuid) id: string) { return this.svc.getArticle(id); }
  @Post('articles') @HttpCode(201) @RequirePlatform('kb:write')
  createArticle(@CurrentUser() u: AuthUser, @Body() dto: KbArticleDto, @ReqMeta() m: RequestMeta) { return this.svc.createArticle(u, dto, m); }
  @Patch('articles/:id') @RequirePlatform('kb:write')
  updateArticle(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: KbArticlePatchDto, @ReqMeta() m: RequestMeta) { return this.svc.updateArticle(u, id, dto, m); }
  @Delete('articles/:id') @HttpCode(204) @RequirePlatform('kb:write')
  async deleteArticle(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() m: RequestMeta) { await this.svc.deleteArticle(u, id, m); }
}

/** Public help centre. Only published articles; no customer data. */
@ApiTags('public')
@Public()
@Controller('public/kb')
export class KbPublicController {
  constructor(private readonly svc: KbService) {}

  @Get('categories')
  categories() { return this.svc.publicCategories(); }
  @Get('articles')
  articles(@Query() q: KbPublicQuery) { return this.svc.publicArticles(q); }
  @Get('articles/:slug')
  article(@Param() p: SlugParam) { return this.svc.publicArticle(p.slug); }
}
