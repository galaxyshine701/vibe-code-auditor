import { Logger, Module } from '@nestjs/common';
import { resolveAccessConfig } from '../access/access-config.js';
import {
  ACCESS_CONFIG,
  ATTEMPT_LIMITER,
  AccessCodeGuard,
} from '../access/access-code.guard.js';
import { AttemptLimiter } from '../access/attempt-limiter.js';
import { SupabaseGateway } from '../prover/gateway.js';
import { AuditsController } from './audits.controller.js';
import { AuditsService, GATEWAY_FACTORY } from './audits.service.js';

@Module({
  controllers: [AuditsController],
  providers: [
    AuditsService,
    AccessCodeGuard,
    {
      provide: GATEWAY_FACTORY,
      useValue: (config: ConstructorParameters<typeof SupabaseGateway>[0]) =>
        new SupabaseGateway(config),
    },
    {
      // Fails closed: with no access code (and no explicit ALLOW_OPEN_API=yes)
      // this throws, and the server does not start.
      provide: ACCESS_CONFIG,
      useFactory: () => {
        const config = resolveAccessConfig(process.env);
        if (config.mode === 'open') {
          new Logger('Access').warn(
            'ALLOW_OPEN_API=yes: the audits API has NO access code. Use this for local testing only.',
          );
        }
        return config;
      },
    },
    { provide: ATTEMPT_LIMITER, useFactory: () => new AttemptLimiter() },
  ],
})
export class AuditsModule {}
