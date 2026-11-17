import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProd = config.get('NODE_ENV', { infer: true }) === 'production';

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Behind Nginx in production: trust exactly one proxy hop for client IP / protocol.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; Swagger UI (non-prod) needs inline assets.
      contentSecurityPolicy: isProd ? { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: false } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Requested-With', 'Idempotency-Key', 'X-Tenant-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  // All business endpoints live under /api/v1. Health checks stay at /health.
  app.setGlobalPrefix('api', { exclude: [{ path: 'health/*path', method: RequestMethod.GET }] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties (mass-assignment protection)
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (!isProd || config.get('SWAGGER_ENABLED', { infer: true })) {
    const doc = new DocumentBuilder()
      .setTitle('CirilInfo SaaS API')
      .setDescription('REST API for the CirilInfo public website, customer portal and admin portal.')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('ci_rt')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), {
      jsonDocumentUrl: 'api/docs/openapi.json',
    });
  }

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API listening on :${port}`);
}

await bootstrap();
