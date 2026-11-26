// The limits of the checks that ran, in plain words. The full technical list is
// the one the server sends, shown under "Technical details". The numbers here are
// the server's (a test compares them with backend/src).
type Pair = { en: string; ur: string };

const NOT_TRIED: Pair = {
  en: 'A key that is found is not tried out, so whether it still works is not known.',
  ur: 'Mili hui key ko chala kar nahi dekha jata, isliye pata nahi wo ab bhi chalti hai ya nahi.',
};

export const PLAIN_LIMITS: Record<string, Pair[]> = {
  'repo-secrets': [
    {
      en: 'Only the default branch of a public repository was read, not old commits.',
      ur: 'Sirf public repository ki default branch parhi gayi, purane commits nahi.',
    },
    {
      en: 'Only text files up to 1 MB were read. Folders such as node_modules and dist were skipped.',
      ur: 'Sirf 1 MB tak ki text files parhi gayin. node_modules aur dist jaise folders chhod diye gaye.',
    },
    {
      en: 'A finding about an env file or a migration is a warning sign, not a proven leak.',
      ur: 'Env file ya migration wala nateeja khatre ki nishani hai, sabit shuda leak nahi.',
    },
    NOT_TRIED,
  ],
  'tls-headers': [
    {
      en: 'Only the front page was read. Cookie settings, TLS versions and other pages were not checked.',
      ur: 'Sirf pehla page parha gaya. Cookie settings, TLS versions aur doosre pages check nahi hue.',
    },
  ],
  'bundle-secrets': [
    {
      en: "Only up to 30 script files from the site's own address were read.",
      ur: 'Sirf site ke apne address ki zyada se zyada 30 script files parhi gayin.',
    },
    NOT_TRIED,
  ],
  'data-access-prover': [
    {
      en: 'Only table data was tested: read, change and delete as another signed-in user, and read as a visitor.',
      ur: 'Sirf table ka data test hua: doosre login user ki tarah parhna, badalna, delete karna, aur visitor ki tarah parhna.',
    },
  ],
};

/** The plain limits of these checks, each sentence once. */
export function plainLimits(checkIds: string[]): Pair[] {
  return [...new Set(checkIds.flatMap((id) => PLAIN_LIMITS[id] ?? []))];
}
