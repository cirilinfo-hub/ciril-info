import { Global, Module } from '@nestjs/common';
import { PlatformPrisma, TenantPrisma } from './prisma-clients.js';

@Global()
@Module({
  providers: [TenantPrisma, PlatformPrisma],
  exports: [TenantPrisma, PlatformPrisma],
})
export class DatabaseModule {}
