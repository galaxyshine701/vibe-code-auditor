import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENTS_OFF } from '../../src/agents/agents-config.js';
import { SCENARIOS, normalize, runScenario } from './scenarios.js';

/**
 * "Flag off = the response is byte for byte what it was before." The files in
 * test/agents/golden were recorded from the code BEFORE the stage agents were
 * written (see golden/_recorded-from.txt). Random ids, times, uuids and
 * emails are replaced before comparing, so the test is not flaky.
 *
 * To record again (only on purpose, from the old code):
 *   UPDATE_GOLDEN=1 npx vitest run test/agents/golden.spec.ts
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const update = process.env.UPDATE_GOLDEN === '1';

describe('flag off: the responses are the recorded ones', () => {
  for (const name of SCENARIOS) {
    it(`scenario "${name}"`, async () => {
      const got = normalize(await runScenario(name, AGENTS_OFF));
      const file = join(dir, `${name}.json`);
      if (update) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
        return;
      }
      expect(existsSync(file)).toBe(true);
      const recorded = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      expect(got).toEqual(recorded);
    }, 30_000);
  }

  it('the recordings are not empty and are not all the same', () => {
    if (update) return;
    const texts = SCENARIOS.map((n) =>
      readFileSync(join(dir, `${n}.json`), 'utf8'),
    );
    expect(new Set(texts).size).toBe(SCENARIOS.length);
    for (const text of texts) expect(text.length).toBeGreaterThan(500);
  });
});
