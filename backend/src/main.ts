import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

// backend/.env (this file lives in backend/dist/ after the build)
loadDotenv({ path: resolve(import.meta.dirname, '../.env'), quiet: true });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // 4000 by default, because the Next.js frontend uses 3000
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
