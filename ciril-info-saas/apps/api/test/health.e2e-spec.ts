import { type INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

config({ path: ['.env', '../../.env'], quiet: true });

describe('HTTP foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api', { exclude: [{ path: 'health/*path', method: RequestMethod.GET }] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live → 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready reports database status', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) expect(res.body.checks.database).toBe(true);
  });

  it('unknown routes return the standard error envelope with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(typeof res.body.error.requestId).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });
});
