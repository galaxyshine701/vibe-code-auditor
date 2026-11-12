import { createHash } from 'node:crypto';
import type { ReportInput } from './report-input.js';
import type { ReportText } from './report-schema.js';

const MAX_ENTRIES = 500;

/**
 * Remembers the checked AI text for a finding, in memory. The same finding
 * (same table, verdict, severity and operations, same prompt and model) never
 * costs a second AI call.
 */
export class ReportCache {
  private readonly entries = new Map<string, ReportText>();

  static key(input: ReportInput, model: string, promptVersion: number) {
    return createHash('sha256')
      .update(JSON.stringify({ v: promptVersion, model, input }))
      .digest('hex');
  }

  get(key: string): ReportText | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: ReportText): void {
    this.entries.set(key, value);
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
