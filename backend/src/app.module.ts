import { Module } from '@nestjs/common';
import { AuditsModule } from './audits/audits.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [AuditsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
