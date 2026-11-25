import { safeFetch, SafeFetchError } from '../net/safe-fetch.js';
import {
  BUNDLE_SCAN_LIMITS,
  CHECKS,
  notProvidedReason,
} from '../stages/planner-config.js';
import {
  extractScriptUrls,
  scanForKeys,
  scriptName,
  type KeyKind,
} from '../stages/site-rules.js';
import type { CheckResult, EvidenceItem, Text } from '../stages/types.js';
import { KEY_FORMATS_LIMIT, foundInScript } from '../stages/key-providers.js';
import type { Agent } from './agent.js';
import type { RunContext } from './run-context.js';
import {
  RUN_STOPPED,
  siteErrorText,
  type SiteFetcher,
} from './site-agent-kit.js';

export const BUNDLE_INSPECTOR_ID = 'bundle-secrets';

const FRONT_PAGE = 'front page (inline script)';

const OTHER_ORIGIN: Text = {
  en: 'A script of another origin is not scanned.',
  ur: 'Doosre origin ki script scan nahi hoti.',
};

const notRead = (name: string, reason: Text) => ({ name, reason });

/**
 * Inspector for the check "bundle-secrets": reads the front page and the
 * scripts of the SAME origin (through the safe fetcher only, within the limits
 * of the plan) and looks for Supabase secret keys. It never tests whether a
 * key works, never copies a key anywhere (only the kind and the script's
 * name), looks at the stop flag before every fetch, and names what it could
 * not read. Plain code.
 */
export function createBundleInspectorAgent(
  options: { fetcher?: SiteFetcher } = {},
): Agent<RunContext> {
  const fetcher: SiteFetcher = options.fetcher ?? safeFetch;
  return {
    id: BUNDLE_INSPECTOR_ID,
    name: 'Bundle scan',
    critical: false,
    async run(context, setProgress, control) {
      const address = context.websiteUrl;
      const results = context.siteResults;
      if (!address || !results) {
        return {
          skipped: notProvidedReason({
            needs: 'website',
            title: CHECKS.find((c) => c.id === BUNDLE_INSPECTOR_ID)!.title,
          }),
        };
      }
      const fail = (reason: Text) => {
        results[BUNDLE_INSPECTOR_ID] = {
          id: BUNDLE_INSPECTOR_ID,
          status: 'failedToRun',
          reason,
        };
      };
      const limits = context.limits?.bundle ?? BUNDLE_SCAN_LIMITS;

      if (control?.shouldStop()) return fail(RUN_STOPPED);
      setProgress(5);
      let page;
      try {
        page = await fetcher(address, { maxBytes: limits.maxFileBytes });
      } catch (error) {
        return fail(siteErrorText(error));
      }
      let total = page.body.length;
      const html = page.body.toString('utf8');

      const { srcs } = extractScriptUrls(html, page.url);
      const origin = new URL(page.url).origin;
      const sameOrigin = srcs.filter((s) => new URL(s).origin === origin);
      const outOfScope = srcs
        .filter((s) => new URL(s).origin !== origin)
        .map((s) => ({ name: scriptName(s), reason: OTHER_ORIGIN }));
      const toRead = sameOrigin.slice(0, limits.maxFiles);
      const missed = [
        ...sameOrigin.slice(limits.maxFiles).map((s) =>
          notRead(scriptName(s), {
            en: 'Not read: the limit of scripts per scan was reached.',
            ur: 'Parhi nahi gayi: ek scan mein scripts ki had poori ho gayi.',
          }),
        ),
      ];

      const hits: { subject: string; kind: KeyKind }[] = [];
      for (const kind of scanForKeys(html))
        hits.push({ subject: FRONT_PAGE, kind });

      for (const [index, script] of toRead.entries()) {
        const name = scriptName(script);
        const left = limits.maxTotalBytes - total;
        let why: Text | null = null;
        if (control?.shouldStop()) {
          why = {
            en: 'Not read: the run was stopped.',
            ur: 'Parhi nahi gayi: run rok diya gaya.',
          };
        } else if (left <= 0) {
          why = {
            en: 'Not read: the total size limit of the scan was reached.',
            ur: 'Parhi nahi gayi: scan ki kul size ki had poori ho gayi.',
          };
        }
        if (why) {
          // the same reason for this script and every one after it
          for (const rest of toRead.slice(index)) {
            missed.push(notRead(scriptName(rest), why));
          }
          break;
        }
        try {
          const file = await fetcher(script, {
            maxBytes: Math.min(limits.maxFileBytes, left),
          });
          if (file.status < 200 || file.status >= 300) {
            missed.push(
              notRead(name, {
                en: 'Not read: the server answered with an error for this file.',
                ur: 'Parhi nahi gayi: server ne is file par error diya.',
              }),
            );
          } else {
            total += file.body.length;
            for (const kind of scanForKeys(file.body.toString('utf8'))) {
              hits.push({ subject: name, kind });
            }
          }
        } catch (error) {
          missed.push(
            notRead(
              name,
              error instanceof SafeFetchError && error.code === 'TOO_LARGE'
                ? {
                    en: 'Not read: the file is larger than the allowed size.',
                    ur: 'Parhi nahi gayi: file ki size had se zyada hai.',
                  }
                : {
                    en: 'Not read: the file could not be fetched.',
                    ur: 'Parhi nahi gayi: file laayi nahi ja saki.',
                  },
            ),
          );
        }
        setProgress(5 + Math.round(((index + 1) / toRead.length) * 90));
      }

      const items: EvidenceItem[] = hits.map((hit, index) => ({
        id: `ev_site_${BUNDLE_INSPECTOR_ID}_${index + 1}`,
        check: BUNDLE_INSPECTOR_ID,
        findingId: null,
        table: null,
        subject: hit.subject,
        kind: 'site-bundle' as const,
        keyKind: hit.kind,
        verdict: 'LEAKED' as const,
        proof: 'PROVEN' as const,
        summary: foundInScript(hit.kind),
      }));
      (context.siteEvidence ??= []).push(...items);

      const result: CheckResult =
        missed.length > 0
          ? {
              id: BUNDLE_INSPECTOR_ID,
              status: 'partial',
              reason: {
                en: 'Some scripts were not read, so this check is not complete.',
                ur: 'Kuch scripts parhi nahi gayin, isliye ye check mukammal nahi.',
              },
              notRead: missed,
              limitNotes: [KEY_FORMATS_LIMIT],
              ...(outOfScope.length > 0 ? { outOfScope } : {}),
            }
          : {
              id: BUNDLE_INSPECTOR_ID,
              status: 'completed',
              limitNotes: [KEY_FORMATS_LIMIT],
              ...(outOfScope.length > 0 ? { outOfScope } : {}),
            };
      results[BUNDLE_INSPECTOR_ID] = result;
      setProgress(100);
    },
  };
}
