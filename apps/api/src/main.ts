import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { BigIntSerialiserInterceptor } from './common/bigint.interceptor';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

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

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /*
   * Trust the platform's own proxy for the caller's real IP.
   *
   * Render (and any container platform) terminates the connection and
   * forwards it, so without this every request looks like it came from the
   * proxy's own address — which means rate limiting would count every
   * caller as the same one caller. Safe locally too: a direct connection
   * has no X-Forwarded-For to trust in the first place.
   */
  app.set('trust proxy', 1);

  // The web app is served from its own origin. An allow-list, not a wildcard:
  // the API carries bearer tokens and posting endpoints.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalInterceptors(new BigIntSerialiserInterceptor());

  // "No such record" is a 404, not a 500 — see the filter for which codes map.
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));

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

  if (process.env.RENDER === 'true') migrateInBackground();
}

/**
 * Apply pending database migrations once the API is live.
 *
 * On Render a starting instance cannot reach the database over the private
 * network until it is serving — the start command's own attempt (see
 * render.yaml) gets P1001 for minutes while the running service queries the
 * same database without trouble. So the migration runs here, after the port
 * is open, as a child process running the same script.
 *
 * Never fatal: the API keeps serving whatever happens, and the outcome is
 * logged in plain words so a failure is visible in the service log rather
 * than surfacing later as a missing table. Idempotent — with nothing
 * pending it is a no-op.
 */
function migrateInBackground(): void {
  const logger = new Logger('Migrations');
  const repoRoot = join(__dirname, '..', '..', '..');
  const child = spawn('npm', ['run', 'migrate:deploy', '-w', '@bioassetpro/database'], {
    cwd: repoRoot,
    env: { ...process.env, MIGRATE_FROM_API: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm is npm.cmd on Windows, which only a shell can run. Render is Linux.
    shell: process.platform === 'win32',
  });
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) logger.log(line.trimEnd());
    }
  };
  child.stdout.on('data', relay);
  child.stderr.on('data', relay);
  child.on('error', (error) => logger.error(`Could not start the migration: ${error.message}`));
  child.on('exit', (code) => {
    if (code === 0) logger.log('Database is up to date.');
    else logger.error(`Migration FAILED (exit ${code}). The API is running on the previous schema.`);
  });
}

void bootstrap();
