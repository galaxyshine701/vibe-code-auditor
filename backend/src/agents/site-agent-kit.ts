import { SafeFetchError } from '../net/safe-fetch.js';
import type { SafeFetchOptions, SafeFetchResult } from '../net/safe-fetch.js';
import type { Text } from '../stages/types.js';

/** What the inspectors fetch with. Tests give a fake; the real one is safeFetch. */
export type SiteFetcher = (
  address: string,
  options?: SafeFetchOptions,
) => Promise<SafeFetchResult>;

export const RUN_STOPPED: Text = {
  en: 'The run was stopped before this check could read the site.',
  ur: 'Run is check se pehle rok diya gaya, isliye site parhi nahi gayi.',
};

/** A fixed sentence for a failed fetch. The address and the library text never go in. */
export function siteErrorText(error: unknown): Text {
  if (error instanceof SafeFetchError) {
    return {
      en: error.message,
      ur: 'Site tak pahunch nahi saka, ya jawab parha nahi ja saka.',
    };
  }
  return {
    en: 'The site could not be read.',
    ur: 'Site parhi nahi ja saki.',
  };
}
