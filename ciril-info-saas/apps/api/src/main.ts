import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const { config, isProd } = configureApp(app);

  if (!isProd || config.get('SWAGGER_ENABLED', { infer: true })) {
    const doc = new DocumentBuilder()
      .setTitle('CirilInfo SaaS API')
      .setDescription('REST API for the CirilInfo public website, customer portal and admin portal.')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('ci_rt_customer')
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
