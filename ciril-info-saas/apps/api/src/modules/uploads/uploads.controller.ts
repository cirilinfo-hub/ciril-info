import { Controller, Get, HttpCode, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Public, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { IMAGE_MIME, MAX_IMAGE_BYTES, UPLOAD_FILE, UploadsService } from './uploads.service.js';

interface UploadedImage {
  buffer?: Buffer;
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  /** Staff upload an image (PNG, JPEG or WebP, up to 3 MB) and get back the path to save on the record. */
  @Post('images')
  @HttpCode(201)
  @RequirePlatform('content:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES + 1, files: 1, fields: 0 } }))
  async image(@UploadedFile() file: UploadedImage | undefined, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const saved = await this.uploads.saveImage(file?.buffer);
    await this.audit.record({ action: 'upload.image', actorId: user.id, entityType: 'upload', entityId: saved.path, metadata: { bytes: saved.bytes }, meta });
    return { path: saved.path };
  }

  /** Public: uploaded images are shown on the website. Only files this service wrote can be requested. */
  @Public()
  @Get('images/:file')
  serve(@Param('file') file: string, @Res() res: Response) {
    if (!UPLOAD_FILE.test(file)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Image not found.' });
    const ext = file.split('.').pop()!;
    res.set({
      'Content-Type': IMAGE_MIME[ext]!,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // The website (another origin) displays these images.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.sendFile(file, { root: this.uploads.dir, dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Image not found.' } });
    });
  }
}
