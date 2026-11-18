import { safeFetch } from '../net/safe-fetch.js';
import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  notProvidedReason,
} from '../stages/planner-config.js';
import { analyzeHeaders } from '../stages/site-rules.js';
import type { EvidenceItem } from '../stages/types.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';
import {
  RUN_STOPPED,
  siteErrorText,
  type SiteFetcher,
} from './site-agent-kit.js';

export const HEADERS_INSPECTOR_ID = 'tls-headers';

/**
 * The certificate itself is not read: the safe fetcher does not hand out the
 * certificate. It is named as left out on purpose (it does not hold the gate
 * back) until the fetcher can show it.
 */
const CERTIFICATE_LEFT_OUT = {
  name: 'Certificate validity and expiry',
  reason: {
    en: 'Not implemented yet: the page fetcher does not give out the certificate.',
    ur: 'Abhi bana nahi: page fetcher certificate nahi deta.',
  },
};

/**
 * Inspector for the check "tls-headers": reads the front page of the site
 * (through the safe fetcher only) and looks at its security headers by fixed
 * rules. A missing header is a gap (INCONCLUSIVE), never a leak. Plain code.
 */
export function createHeadersInspectorAgent(
  options: { fetcher?: SiteFetcher } = {},
): Agent<RunContext> {
  const fetcher: SiteFetcher = options.fetcher ?? safeFetch;
  return {
    id: HEADERS_INSPECTOR_ID,
    name: 'Site headers',
    critical: false,
    async run(context, setProgress, control) {
      const address = context.websiteUrl;
      const results = context.siteResults;
      if (!address || !results) {
        return {
          skipped: notProvidedReason({
            needs: 'website',
            title: CHECKS.find((c) => c.id === HEADERS_INSPECTOR_ID)!.title,
          }),
        };
      }
      if (control?.shouldStop()) {
        results[HEADERS_INSPECTOR_ID] = {
          id: HEADERS_INSPECTOR_ID,
          status: 'failedToRun',
          reason: RUN_STOPPED,
        };
        return;
      }
      setProgress(10);
      let page;
      try {
        const limits = context.limits?.bundle ?? BUNDLE_SCAN_LIMITS;
        page = await fetcher(address, { maxBytes: limits.maxFileBytes });
      } catch (error) {
        results[HEADERS_INSPECTOR_ID] = {
          id: HEADERS_INSPECTOR_ID,
          status: 'failedToRun',
          reason: siteErrorText(error),
        };
        return;
      }
      const items: EvidenceItem[] = analyzeHeaders(page.headers, page.url).map(
        (found, index) => ({
          id: `ev_site_${HEADERS_INSPECTOR_ID}_${index + 1}`,
          check: HEADERS_INSPECTOR_ID,
          findingId: null,
          table: null,
          subject: found.subject,
          kind: 'site-headers' as const,
          // present = BLOCKED, missing or weak = INCONCLUSIVE. Never LEAKED.
          verdict: found.ok ? ('BLOCKED' as const) : ('INCONCLUSIVE' as const),
          proof: 'PROVEN' as const,
          summary: { en: found.en, ur: found.ur },
        }),
      );
      (context.siteEvidence ??= []).push(...items);
      results[HEADERS_INSPECTOR_ID] = {
        id: HEADERS_INSPECTOR_ID,
        status: 'completed',
        outOfScope: [CERTIFICATE_LEFT_OUT],
      };
      setProgress(100);
    },
  };
}
