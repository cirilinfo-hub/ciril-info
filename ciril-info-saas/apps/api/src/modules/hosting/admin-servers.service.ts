import { randomUUID } from 'node:crypto';
import { Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsIP, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { PlatformPrisma } from '../../database/prisma-clients.js';
import type { HostingAccountStatus } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser, RequestMeta } from '../auth/auth.types.js';
import { CurrentUser, ReqMeta, RequirePlatform } from '../auth/decorators.js';
import { HostingGateway } from './hosting-gateway.js';
import { ProvisioningError } from './providers/hosting-provider.js';
import { providerForServer, serverSecretContext } from './providers/servers-hosting.provider.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const HOST = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$|^(\d{1,3}\.){3}\d{1,3}$|^localhost$/;

export class ServerPatchDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
  @IsOptional() @Transform(lower) @Matches(HOST, { message: 'Enter the server name, for example server1.yourhost.com.' }) hostname?: string;
  @IsOptional() @Transform(trim) @IsIP(4, { message: 'Enter the server’s shared IPv4 address.' }) ipAddress?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) username?: string | null;
  @IsOptional() @IsIn(['verify', 'skip', 'off']) tls?: 'verify' | 'skip' | 'off';
  @IsOptional() @IsInt() @Min(1) @Max(100_000) maxAccounts?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(13) @IsString({ each: true }) @MaxLength(253, { each: true }) nameservers?: string[];
  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'FULL', 'RETIRED']) status?: 'ACTIVE' | 'MAINTENANCE' | 'FULL' | 'RETIRED';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) location?: string | null;
  /** WHM API token, Plesk API key or FASTPANEL API token. Write-only: never returned. Send it only to replace the saved one. */
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 4096) secret?: string;
}

export class ServerDto extends ServerPatchDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) declare name: string;
  @ApiProperty() @Transform(lower) @Matches(HOST, { message: 'Enter the server name, for example server1.yourhost.com.' }) declare hostname: string;
  @ApiProperty() @Transform(trim) @IsIP(4, { message: 'Enter the server’s shared IPv4 address.' }) declare ipAddress: string;
  @ApiProperty({ enum: ['CPANEL', 'PLESK', 'FASTPANEL'] }) @IsIn(['CPANEL', 'PLESK', 'FASTPANEL']) panel!: 'CPANEL' | 'PLESK' | 'FASTPANEL';
  @ApiProperty() @IsString() @Length(8, 4096) declare secret: string;
}

/** Accounts that take up room on a server. */
const LIVE_ACCOUNTS: HostingAccountStatus[] = ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED'];

const select = {
  id: true, name: true, hostname: true, ipAddress: true, panel: true, port: true, username: true, tls: true, location: true, status: true, maxAccounts: true,
  nameservers: true, lastCheckedAt: true, lastCheck: true, createdAt: true, credentialsEnc: true,
  _count: { select: { accounts: { where: { status: { in: LIVE_ACCOUNTS } } } } },
} as const;

type Row = { credentialsEnc: string | null; _count: { accounts: number } } & Record<string, unknown>;
/** Never the credentials themselves: only whether they are saved, and how full the server is. */
const view = ({ credentialsEnc, _count, ...rest }: Row) => ({ ...rest, credentialsSet: Boolean(credentialsEnc), accounts: _count.accounts });

/**
 * Admin portal: the hosting servers that HOSTING_PROVIDER=servers spreads accounts over. Credentials are encrypted with the
 * data key (bound to the server's id) and never sent back. "Test connection" makes a harmless call to the panel.
 */
@Injectable()
export class AdminServersService {
  constructor(
    private readonly db: PlatformPrisma,
    private readonly gateway: HostingGateway,
    private readonly audit: AuditService,
  ) {}

  get mode() {
    return this.gateway.provider.id;
  }

  async list() {
    const rows = await this.db.hostingServer.findMany({ select, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
    return { inUse: this.gateway.provider.id === 'SERVERS', data: rows.map((r) => view(r as unknown as Row)) };
  }

  async create(user: AuthUser, dto: ServerDto, meta: RequestMeta) {
    if (await this.db.hostingServer.findUnique({ where: { hostname: dto.hostname }, select: { id: true } })) {
      throw new ConflictException({ code: 'SERVER_EXISTS', message: 'A server with this name is already listed.' });
    }
    const id = randomUUID();
    const row = await this.db.hostingServer.create({
      data: {
        id, name: dto.name, hostname: dto.hostname, ipAddress: dto.ipAddress, panel: dto.panel, port: dto.port ?? null, username: dto.username || null, tls: dto.tls ?? 'verify',
        maxAccounts: dto.maxAccounts ?? 500, nameservers: this.ns(dto.nameservers), location: dto.location || null, status: dto.status ?? 'ACTIVE',
        credentialsEnc: this.gateway.box.encrypt(dto.secret, serverSecretContext(id)),
      },
      select,
    });
    await this.audit.record({ action: 'hosting_server.create', actorId: user.id, entityType: 'hosting_server', entityId: id, metadata: { name: dto.name, hostname: dto.hostname, panel: dto.panel }, meta });
    return view(row as unknown as Row);
  }

  async update(user: AuthUser, id: string, dto: ServerPatchDto, meta: RequestMeta) {
    const current = await this.db.hostingServer.findUnique({ where: { id }, select: { id: true, hostname: true } });
    if (!current) throw new NotFoundException({ code: 'SERVER_NOT_FOUND', message: 'Server not found.' });
    if (dto.hostname && dto.hostname !== current.hostname && (await this.db.hostingServer.findUnique({ where: { hostname: dto.hostname }, select: { id: true } }))) {
      throw new ConflictException({ code: 'SERVER_EXISTS', message: 'A server with this name is already listed.' });
    }
    const { secret, nameservers, ...rest } = dto;
    const row = await this.db.hostingServer.update({
      where: { id },
      data: {
        ...rest, ...(rest.username !== undefined ? { username: rest.username || null } : {}), ...(nameservers ? { nameservers: this.ns(nameservers) } : {}),
        ...(secret ? { credentialsEnc: this.gateway.box.encrypt(secret, serverSecretContext(id)) } : {}),
      },
      select,
    });
    await this.audit.record({ action: 'hosting_server.update', actorId: user.id, entityType: 'hosting_server', entityId: id, metadata: { fields: Object.keys(dto).map((k) => (k === 'secret' ? 'credentials' : k)) }, meta });
    return view(row as unknown as Row);
  }

  /** Calls the panel with the saved details and records what happened. */
  async test(user: AuthUser, id: string, meta: RequestMeta) {
    const s = await this.db.hostingServer.findUnique({ where: { id }, select: { id: true, name: true, hostname: true, ipAddress: true, panel: true, port: true, username: true, tls: true, credentialsEnc: true, updatedAt: true } });
    if (!s) throw new NotFoundException({ code: 'SERVER_NOT_FOUND', message: 'Server not found.' });
    let ok = false;
    let message: string;
    try {
      const p = providerForServer(s, this.gateway.box);
      message = p.ping ? `Connected: ${await p.ping()}` : 'Connected.';
      ok = true;
    } catch (e) {
      if (!(e instanceof ProvisioningError)) throw e;
      message = e.message;
    }
    const row = await this.db.hostingServer.update({ where: { id }, data: { lastCheckedAt: new Date(), lastCheck: message.slice(0, 255) }, select });
    await this.audit.record({ action: 'hosting_server.test', actorId: user.id, entityType: 'hosting_server', entityId: id, metadata: { ok }, meta });
    return { ok, message, server: view(row as unknown as Row) };
  }

  private ns(list: string[] | undefined) {
    return [...new Set((list ?? []).map((n) => n.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean))];
  }
}

const uuid = new ParseUUIDPipe({ version: '4' });

/** Admin portal: hosting servers. Reading needs hosting access; changing a server (credentials included) needs settings access. */
@ApiTags('admin · hosting servers')
@Controller('admin/hosting-servers')
export class AdminServersController {
  constructor(private readonly svc: AdminServersService) {}

  @Get() @RequirePlatform('hosting:read')
  list() { return this.svc.list(); }

  @Post() @RequirePlatform('settings:write')
  create(@CurrentUser() u: AuthUser, @Body() dto: ServerDto, @ReqMeta() meta: RequestMeta) { return this.svc.create(u, dto, meta); }

  @Patch(':id') @RequirePlatform('settings:write')
  update(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: ServerPatchDto, @ReqMeta() meta: RequestMeta) { return this.svc.update(u, id, dto, meta); }

  @Post(':id/test') @HttpCode(200) @RequirePlatform('hosting:write')
  test(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @ReqMeta() meta: RequestMeta) { return this.svc.test(u, id, meta); }
}
