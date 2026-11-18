import { createClient } from '@supabase/supabase-js';
import { resolvePlatformConfig } from '../../src/audits/platform-config.js';
import { SupabaseAuditRepository } from '../../src/audits/supabase-audit-repository.js';
import { describeRepositoryContract } from './repository-contract.js';

/**
 * Runs the audit store rules against a REAL Supabase project: the platform's
 * TEST project, with public.vca_audits created from migrations/001_vca_audits.sql.
 * It is skipped unless both variables are set. Use a test project, not the
 * real platform project: the test writes rows with ids aud_contract_*.
 */
const url = process.env.TEST_PLATFORM_SUPABASE_URL;
const key = process.env.TEST_PLATFORM_SUPABASE_SERVICE_KEY;
const enabled = Boolean(url && key);

describeRepositoryContract(
  'Supabase (integration)',
  () =>
    new SupabaseAuditRepository(
      resolvePlatformConfig({
        PLATFORM_SUPABASE_URL: url,
        PLATFORM_SUPABASE_SERVICE_KEY: key,
      }),
    ),
  { skip: !enabled },
);

(enabled ? describe : describe.skip)('Supabase audit store: clean up', () => {
  it('removes the rows this test run made', async () => {
    const client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client
      .from('vca_audits')
      .delete()
      .like('id', 'aud_contract_%');
    expect(error).toBeNull();
  });
});
