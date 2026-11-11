import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { resolveAccessConfig } from './access/access-config.js';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

// backend/.env (this file lives in backend/dist/ after the build)
loadDotenv({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

async function bootstrap() {
  // Check the protection settings first: no access code means no server.
  resolveAccessConfig(process.env);
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configureApp(app);
  // 4000 by default, because the Next.js frontend uses 3000
  await app.listen(process.env.PORT ?? 4000);
}

try {
  await bootstrap();
} catch (error) {
  // A short, plain message. It never contains a secret.
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`Server did not start: ${message}`);
  process.exit(1);
}
