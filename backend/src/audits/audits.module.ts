import { Logger, Module } from '@nestjs/common';
import {
  resolveAccessConfig,
  resolveClientIpHeader,
} from '../access/access-config.js';
import {
  ACCESS_CONFIG,
  ATTEMPT_LIMITER,
  CLIENT_IP_HEADER,
  AccessCodeGuard,
} from '../access/access-code.guard.js';
import { AttemptLimiter } from '../access/attempt-limiter.js';
import { SupabaseGateway } from '../prover/gateway.js';
import { AuditsController } from './audits.controller.js';
import { AuditsService, GATEWAY_FACTORY } from './audits.service.js';
import { REPORT_SETUP, resolveReportSetup } from '../report/report-config.js';

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
    {
      // Where the client address comes from. A fixed sentence, no values.
      provide: CLIENT_IP_HEADER,
      useFactory: () => {
        const header = resolveClientIpHeader(process.env);
        new Logger('Access').log(
          header
            ? `Client IP source: header ${header}`
            : 'Client IP source: request.ip',
        );
        return header;
      },
    },
    { provide: ATTEMPT_LIMITER, useFactory: () => new AttemptLimiter() },
    {
      // Off unless REPORT_AGENT=groq. Warnings are fixed sentences, no values.
      provide: REPORT_SETUP,
      useFactory: () => {
        const { setup, warnings } = resolveReportSetup(process.env);
        const log = new Logger('Report');
        for (const warning of warnings) log.warn(warning);
        log.log(`Report agent: ${setup.mode}`);
        return setup;
      },
    },
  ],
})
export class AuditsModule {}
