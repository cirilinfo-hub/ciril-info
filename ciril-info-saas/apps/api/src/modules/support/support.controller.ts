import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, RequestMeta, TenantContext } from '../auth/auth.types.js';
import { CurrentTenant, CurrentUser, ReqMeta, RequirePlatform, RequireTenant } from '../auth/decorators.js';
import { AdminSupportService } from './admin-support.service.js';
import { AdminTicketListQuery, CreateTicketDto, ReplyDto, StaffReplyDto, TicketListQuery, TicketPatchDto } from './support.dto.js';
import { SupportService } from './support.service.js';
import { MAX_ATTACHMENT_BYTES, MAX_FILES_PER_MESSAGE, attachmentDisposition } from './attachments.js';
import type { UploadedFileLike } from './attachment-store.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Accepts plain JSON or multipart (text fields plus up to five files, each at most 5 MB). */
const files = () => FilesInterceptor('files', MAX_FILES_PER_MESSAGE, { limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, files: MAX_FILES_PER_MESSAGE, fields: 12 } });

/** Sends a stored file as a download, never displayed in the browser. */
function sendFile(res: Response, f: { fileName: string; contentType: string; sizeBytes: number; stream: NodeJS.ReadableStream }) {
  res.set({
    'Content-Type': f.contentType,
    'Content-Length': String(f.sizeBytes),
    'Content-Disposition': attachmentDisposition(f.fileName),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(f.stream as import('node:stream').Readable);
}

/** Customer portal: the organisation's own tickets. */
@ApiTags('support')
@Controller('tickets')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  @Get() @RequireTenant('support:read')
  list(@CurrentTenant() ctx: TenantContext, @Query() q: TicketListQuery) { return this.svc.list(ctx, q); }

  @Post() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @RequireTenant('support:write') @ApiConsumes('application/json', 'multipart/form-data') @UseInterceptors(files())
  create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateTicketDto, @UploadedFiles() uploaded: UploadedFileLike[] | undefined, @ReqMeta() meta: RequestMeta) { return this.svc.create(ctx, dto, uploaded, meta); }

  @Get(':id') @RequireTenant('support:read')
  get(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string) { return this.svc.get(ctx, id); }

  @Post(':id/messages') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } }) @RequireTenant('support:write') @ApiConsumes('application/json', 'multipart/form-data') @UseInterceptors(files())
  reply(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Body() dto: ReplyDto, @UploadedFiles() uploaded: UploadedFileLike[] | undefined, @ReqMeta() meta: RequestMeta) { return this.svc.reply(ctx, id, dto.body, uploaded, meta); }

  @Get(':id/attachments/:fileId') @RequireTenant('support:read')
  async attachment(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @Param('fileId', uuid) fileId: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.svc.download(ctx, id, fileId));
  }

  @Post(':id/close') @HttpCode(200) @RequireTenant('support:write')
  close(@CurrentTenant() ctx: TenantContext, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.close(ctx, id, meta); }
}

/** Admin portal: support inbox across all customers. */
@ApiTags('admin · support')
@Controller('admin/tickets')
export class AdminSupportController {
  constructor(private readonly svc: AdminSupportService) {}

  @Get() @RequirePlatform('support:read')
  list(@Query() q: AdminTicketListQuery, @CurrentUser() u: AuthUser) { return this.svc.list(q, u); }

  @Get(':id') @RequirePlatform('support:read')
  get(@Param('id', uuid) id: string) { return this.svc.get(id); }

  @Post(':id/messages') @HttpCode(200) @RequirePlatform('support:write') @ApiConsumes('application/json', 'multipart/form-data') @UseInterceptors(files())
  reply(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: StaffReplyDto, @UploadedFiles() uploaded: UploadedFileLike[] | undefined, @ReqMeta() meta: RequestMeta) { return this.svc.reply(u, id, dto, uploaded, meta); }

  @Get(':id/attachments/:fileId') @RequirePlatform('support:read')
  async attachment(@Param('id', uuid) id: string, @Param('fileId', uuid) fileId: string, @Res({ passthrough: true }) res: Response) {
    return sendFile(res, await this.svc.download(id, fileId));
  }

  @Patch(':id') @RequirePlatform('support:write')
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: TicketPatchDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(u, id, dto, meta); }
}
