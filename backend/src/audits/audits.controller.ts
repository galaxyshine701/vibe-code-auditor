import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessCodeGuard } from '../access/access-code.guard.js';
import { parseAuditInput } from './audit-input.js';
import { AuditsService } from './audits.service.js';

// Every route here needs the X-Access-Code header (see AccessCodeGuard).
@UseGuards(AccessCodeGuard)
@Controller('audits')
export class AuditsController {
  constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}

  /** 202 at once; poll GET /audits/:id for progress. Keys are write-only. */
  @Post()
  @HttpCode(202)
  create(@Body() body: unknown) {
    return this.audits.start(parseAuditInput(body));
  }

  @Get(':id')
  status(@Param('id') id: string) {
    return this.audits.get(id);
  }

  @Get(':id/findings')
  findings(@Param('id') id: string) {
    return this.audits.getFindings(id);
  }
}
