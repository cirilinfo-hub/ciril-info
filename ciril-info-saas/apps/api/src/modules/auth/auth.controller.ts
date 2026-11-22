import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser, RequestMeta } from './auth.types.js';
import {
  ChangePasswordDto,
  EmailDto,
  ForgotPasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaDisableDto,
  MfaVerifyDto,
  PortalQueryDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
} from './auth.dto.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { AllowIncompleteAuth, CurrentUser, Public, ReqMeta } from './decorators.js';
import { SessionService, refreshCookieName } from './session.service.js';

/**
 * Requests that rely on the refresh cookie must carry this header. Browsers do not
 * let cross-site forms set custom headers, so this blocks CSRF in addition to
 * SameSite=Strict cookies and the CORS allow-list.
 */
function requireCsrfHeader(req: Request) {
  if (req.headers['x-requested-with'] !== 'cirilinfo') {
    throw new ForbiddenException({ code: 'CSRF', message: 'Request blocked.' });
  }
}

const accepted = { status: 'ACCEPTED' } as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private respond(res: Response, r: LoginResult) {
    if (r.status === 'MFA_REQUIRED') return r;
    this.sessions.setCookie(res, r.portal, r.refreshToken);
    return { status: r.status, accessToken: r.accessToken, expiresIn: r.expiresIn, next: r.next };
  }

  @Public()
  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a customer account and organisation; sends a verification email' })
  async register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.register(dto, meta);
    return { ...accepted, message: 'Check your email to verify your address and finish signing up.' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Body() dto: TokenDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.verifyEmail(dto.token, meta);
    return { status: 'VERIFIED' };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resend(@Body() dto: EmailDto) {
    await this.auth.resendVerification(dto.email);
    return { ...accepted, message: 'If that account needs verifying, we have sent a new link.' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Password sign-in. Returns an access token, or MFA_REQUIRED with a challenge token' })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto.email, dto.password, dto.portal, meta));
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Second step of sign-in: TOTP code or a recovery code' })
  async mfaVerify(@Body() dto: MfaVerifyDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.completeMfaLogin(dto.mfaToken, dto.code, dto.recoveryCode, meta));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh cookie and issue a new access token' })
  async refresh(@Query() q: PortalQueryDto, @Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    const cookies = req.cookies as Record<string, string | undefined>;
    try {
      const r = await this.auth.refresh(cookies[refreshCookieName(q.portal)], q.portal, meta);
      this.sessions.setCookie(res, q.portal, r.refreshToken);
      return { accessToken: r.accessToken, expiresIn: r.expiresIn };
    } catch (err) {
      if ((err as { status?: number }).status === 401) this.sessions.clearCookie(res, q.portal);
      throw err;
    }
  }

  @AllowIncompleteAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    requireCsrfHeader(req);
    await this.auth.logout(user, meta);
    this.sessions.clearCookie(res, user.portal);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgot(@Body() dto: ForgotPasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.forgotPassword(dto.email, dto.portal, meta);
    return { ...accepted, message: 'If an account exists for that email, we have sent a reset link. It expires in 1 hour.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reset(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.resetPassword(dto.token, dto.password, meta);
    return { status: 'PASSWORD_RESET', message: 'Your password has been changed. Sign in with your new password.' };
  }

  @AllowIncompleteAuth()
  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change password (signs out all other sessions)' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword, meta);
  }

  @AllowIncompleteAuth()
  @Post('mfa/setup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start two-step verification setup (returns secret and otpauth URL for a QR code)' })
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user);
  }

  @AllowIncompleteAuth()
  @Post('mfa/enable')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm setup with a code; returns one-time recovery codes' })
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.mfaEnable(user, dto.code, meta);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: MfaDisableDto, @ReqMeta() meta: RequestMeta) {
    await this.auth.mfaDisable(user, dto.code, dto.recoveryCode, meta);
  }

  @AllowIncompleteAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current user, session state, platform role or organisation memberships' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
