import { Module } from '@nestjs/common';
import { SupabaseGateway } from '../prover/gateway.js';
import { AuditsController } from './audits.controller.js';
import { AuditsService, GATEWAY_FACTORY } from './audits.service.js';

@Module({
  controllers: [AuditsController],
  providers: [
    AuditsService,
    {
      provide: GATEWAY_FACTORY,
      useValue: (config: ConstructorParameters<typeof SupabaseGateway>[0]) =>
        new SupabaseGateway(config),
    },
  ],
})
export class AuditsModule {}
