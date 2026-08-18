import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BigIntSerialiserInterceptor } from './common/bigint.interceptor';

/**
 * Load the repo-root .env before anything reads process.env.
 *
 * Node has done this natively since 20.12, so no dotenv dependency. Real
 * environment variables already set are left alone — a deployed environment's
 * configuration must win over a file that happens to be on disk.
 */
function loadEnv(): void {
  for (const candidate of ['.env', '../../.env', '../../../.env']) {
    const path = join(process.cwd(), candidate);
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadEnv();

  const app = await NestFactory.create(AppModule);

  // The web app is served from its own origin. An allow-list, not a wildcard:
  // the API carries bearer tokens and posting endpoints.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalInterceptors(new BigIntSerialiserInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The control panel lives at the root; everything else is under /api.
  app.setGlobalPrefix('api', { exclude: ['/'] });

  /*
   * Bind on every interface, not just loopback.
   *
   * A container platform routes traffic to the container's address, not to
   * 127.0.0.1 inside it — an API listening only on loopback answers its own
   * health check and nothing else, and the deploy fails with no error in the
   * logs to explain why.
   */
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`BioAssetPro API listening on :${port}`);
}

void bootstrap();
