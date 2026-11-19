import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const FULL = {
  VCA_API_URL: 'https://api.example.test/',
  VCA_ACCESS_CODE: 'fake-long-random-code-1234',
  SUPABASE_URL: 'https://fakeproject.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'fake-publishable-key-111111',
  SUPABASE_SECRET_KEY: 'fake-secret-key-222222',
};

function message(env: NodeJS.ProcessEnv): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('reads the settings and trims a trailing slash', () => {
    const { config, warnings } = loadConfig({ ...FULL });
    expect(config.apiUrl).toBe('https://api.example.test');
    expect(config.confirmTestProject).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('turns confirmTestProject on only for exactly "yes"', () => {
    expect(
      loadConfig({ ...FULL, VCA_CONFIRM_TEST_PROJECT: 'yes' }).config
        .confirmTestProject,
    ).toBe(true);
    for (const value of ['true', '1', 'YES', 'y', '']) {
      expect(
        loadConfig({ ...FULL, VCA_CONFIRM_TEST_PROJECT: value }).config
          .confirmTestProject,
      ).toBe(false);
    }
  });

  it('says mcp/.env is missing when nothing is set', () => {
    const text = message({});
    expect(text).toContain('mcp/.env');
    expect(text).toContain('mcp/.env.example');
  });

  it('names the missing variables and never prints a value that is set', () => {
    const text = message({
      SUPABASE_SECRET_KEY: FULL.SUPABASE_SECRET_KEY,
      VCA_ACCESS_CODE: FULL.VCA_ACCESS_CODE,
    });
    expect(text).toContain('VCA_API_URL');
    expect(text).toContain('SUPABASE_URL');
    expect(text).toContain('SUPABASE_PUBLISHABLE_KEY');
    expect(text).not.toContain('SUPABASE_SECRET_KEY');
    expect(text).not.toContain(FULL.SUPABASE_SECRET_KEY);
    expect(text).not.toContain(FULL.VCA_ACCESS_CODE);
  });

  it('warns about an access code shorter than 8 characters, without printing it', () => {
    const { warnings } = loadConfig({ ...FULL, VCA_ACCESS_CODE: 'abc1234' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('VCA_ACCESS_CODE');
    expect(warnings[0]).toContain('8');
    expect(warnings[0]).not.toContain('abc1234');
  });

  it('does not warn at exactly 8 characters', () => {
    expect(
      loadConfig({ ...FULL, VCA_ACCESS_CODE: 'abcd1234' }).warnings,
    ).toEqual([]);
  });

  it('rejects a bad address by variable name, without printing it', () => {
    const bad = 'not a url with secret-token-999';
    const text = message({ ...FULL, VCA_API_URL: bad });
    expect(text).toContain('VCA_API_URL');
    expect(text).not.toContain('secret-token-999');
    expect(
      message({ ...FULL, SUPABASE_URL: 'http://x.supabase.co' }),
    ).toContain('SUPABASE_URL');
  });
});
