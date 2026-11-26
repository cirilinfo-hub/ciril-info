import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { VirusScanner } from '../security/virus-scanner.js';
import { LocalStorage, OBJECT_STORAGE, type ObjectStorage, S3Storage } from './object-storage.js';

export function storageFromConfig(config: ConfigService<Env, true>): ObjectStorage {
  if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
    return new S3Storage({
      bucket: config.get('S3_BUCKET', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }) || undefined,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      prefix: config.get('S3_PREFIX', { infer: true }),
    });
  }
  return new LocalStorage(config.get('STORAGE_LOCAL_DIR', { infer: true }));
}

/** Uploaded files (website images, ticket attachments): the server's disk or an S3 bucket, chosen by STORAGE_DRIVER, and the virus scanner that checks them first. */
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, inject: [ConfigService], useFactory: storageFromConfig }, VirusScanner],
  exports: [OBJECT_STORAGE, VirusScanner],
})
export class StorageModule {}
