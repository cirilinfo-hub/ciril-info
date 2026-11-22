import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { SecretBox } from '../../common/security/crypto.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService, SECRET_BOX } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { TenantGuard } from './tenant.guard.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({ secret: config.get('JWT_ACCESS_SECRET', { infer: true }) }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    TokenService,
    RbacService,
    {
      provide: SECRET_BOX,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new SecretBox(config.get('DATA_ENCRYPTION_KEY', { infer: true })),
    },
    // Order matters: authentication first, then tenant resolution.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
  exports: [RbacService, PasswordService, SessionService, TokenService, SECRET_BOX],
})
export class AuthModule {}
