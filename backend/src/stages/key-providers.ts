import type { KeyKind } from './site-rules.js';
import type { Text } from './types.js';

/**
 * What the audit says about each kind of key it can find: the provider's name
 * and where the key is rotated. Fixed texts only. A key itself is never here.
 * The two Supabase kinds keep the words they always had.
 */
export interface KeyProvider {
  /** the provider, as a name: "OpenAI" */
  name: string;
  /** the kind of key with its article, for a sentence: "an OpenAI API key (sk-...)" */
  label: Text;
  /** where to rotate it, to finish "Rotate the key now: ..." */
  rotateWhere: Text;
}

const SUPABASE_ROTATE: Text = {
  en: 'in Supabase go to API keys, create a new secret key and delete the old one',
  ur: 'Supabase -> API keys mein nayi secret key banayein aur purani delete karein',
};

export const KEY_PROVIDERS: Record<KeyKind, KeyProvider> = {
  'secret-key': {
    name: 'Supabase',
    label: {
      en: 'a Supabase secret key (sb_secret_...)',
      ur: 'Supabase ki secret key (sb_secret_...)',
    },
    rotateWhere: SUPABASE_ROTATE,
  },
  'service-role-jwt': {
    name: 'Supabase',
    label: {
      en: 'a Supabase service_role key',
      ur: 'Supabase ki service_role key',
    },
    rotateWhere: SUPABASE_ROTATE,
  },
  'sk-key': {
    name: 'OpenAI',
    label: { en: 'an OpenAI API key (sk-...)', ur: 'OpenAI ki API key (sk-...)' },
    rotateWhere: {
      en: 'in the OpenAI dashboard go to API keys, create a new key and delete the old one',
      ur: 'OpenAI dashboard mein API keys par jayein, nayi key banayein aur purani delete karein',
    },
  },
  'stripe-secret-key': {
    name: 'Stripe',
    label: {
      en: 'a Stripe secret key (sk_live_... or rk_live_...)',
      ur: 'Stripe ki secret key (sk_live_... ya rk_live_...)',
    },
    rotateWhere: {
      en: 'in the Stripe dashboard go to Developers -> API keys, roll the key and delete the old one',
      ur: 'Stripe dashboard mein Developers -> API keys par jayein, key roll karein aur purani delete karein',
    },
  },
  'aws-access-key-id': {
    name: 'AWS',
    label: {
      en: 'an AWS access key id (AKIA...)',
      ur: 'AWS ki access key id (AKIA...)',
    },
    rotateWhere: {
      en: 'in the AWS console go to IAM -> Security credentials, create a new access key, make the old one inactive and delete it',
      ur: 'AWS console mein IAM -> Security credentials par jayein, nayi access key banayein, purani ko inactive karke delete karein',
    },
  },
  'github-token': {
    name: 'GitHub',
    label: {
      en: 'a GitHub token (ghp_... or github_pat_...)',
      ur: 'GitHub ka token (ghp_... ya github_pat_...)',
    },
    rotateWhere: {
      en: 'in GitHub go to Settings -> Developer settings -> Personal access tokens, delete the token and create a new one with the fewest permissions',
      ur: 'GitHub mein Settings -> Developer settings -> Personal access tokens par jayein, token delete karein aur kam se kam permissions wala naya banayein',
    },
  },
  'slack-token': {
    name: 'Slack',
    label: { en: 'a Slack bot token (xoxb-...)', ur: 'Slack ka bot token (xoxb-...)' },
    rotateWhere: {
      en: 'in your Slack app settings go to OAuth & Permissions and rotate or revoke the token',
      ur: 'Apni Slack app ki settings mein OAuth & Permissions par jayein aur token rotate ya revoke karein',
    },
  },
  'sk-ant-key': {
    name: 'Anthropic',
    label: {
      en: 'an Anthropic API key (sk-ant-...)',
      ur: 'Anthropic ki API key (sk-ant-...)',
    },
    rotateWhere: {
      en: 'in the Anthropic Console go to API keys, create a new key and delete the old one',
      ur: 'Anthropic Console mein API keys par jayein, nayi key banayein aur purani delete karein',
    },
  },
  'gsk-key': {
    name: 'Groq',
    label: { en: 'a Groq API key (gsk_...)', ur: 'Groq ki API key (gsk_...)' },
    rotateWhere: {
      en: 'in the Groq console go to API Keys, create a new key and delete the old one',
      ur: 'Groq console mein API Keys par jayein, nayi key banayein aur purani delete karein',
    },
  },
};

/** What the checks say they look for and what they leave out. Shown in the coverage limits. */
export const KEY_FORMATS_LIMIT: Text = {
  en: 'The keys that are looked for: a Supabase secret key or service_role key, and the secret keys of OpenAI (sk-), Stripe (sk_live_, rk_live_), AWS (access key id AKIA), GitHub (ghp_, github_pat_), Slack (xoxb-), Anthropic (sk-ant-) and Groq (gsk_), each by its fixed prefix and a minimum length. Google keys (AIza) and Stripe publishable keys (pk_) are meant to be public and are not reported. Values that are only examples (xxxx, your_..., example, changeme) are skipped.',
  ur: 'Jin keys ko dhoonda jata hai: Supabase ki secret key ya service_role key, aur OpenAI (sk-), Stripe (sk_live_, rk_live_), AWS (access key id AKIA), GitHub (ghp_, github_pat_), Slack (xoxb-), Anthropic (sk-ant-) aur Groq (gsk_) ki secret keys, har ek apne tay shuda prefix aur kam az kam lambai se. Google keys (AIza) aur Stripe ki publishable keys (pk_) public hone ke liye hoti hain, unhein report nahi kiya jata. Jo values sirf misal hain (xxxx, your_..., example, changeme) chhod di jati hain.',
};

export function isSupabaseKind(kind: KeyKind): boolean {
  return kind === 'secret-key' || kind === 'service-role-jwt';
}

/** The kind of an evidence item that has none (made before other providers): a Supabase key. */
export function kindOrDefault(kind: string | undefined): KeyKind {
  return kind !== undefined && kind in KEY_PROVIDERS
    ? (kind as KeyKind)
    : 'secret-key';
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the evidence says about a key in a file of the repository. */
export function foundInRepo(kind: KeyKind): Text {
  const label = KEY_PROVIDERS[kind].label;
  return {
    en: `${cap(label.en)} is in this file of the repository. Anyone who opens the repository can read it, and old commits keep it. Rotate the key and remove it from the file.`,
    ur: `Repository ki is file mein ${label.ur} maujood hai. Jo bhi repository kholta hai use parh sakta hai, aur purane commits mein bhi rehti hai. Key rotate karein aur file se hatayein.`,
  };
}

/** What the evidence says about a key in a script of the site. */
export function foundInScript(kind: KeyKind): Text {
  const label = KEY_PROVIDERS[kind].label;
  return {
    en: `${cap(label.en)} is in this script. Anyone who opens the site can read it. Remove it from the site and create a new key.`,
    ur: `Is script mein ${label.ur} maujood hai. Jo bhi site kholta hai use parh sakta hai. Use site se hatayein aur nayi key banayein.`,
  };
}

/** The first step of a roadmap item: rotate the key where it was issued. */
export function rotateStep(kind: KeyKind): Text {
  const where = KEY_PROVIDERS[kind].rotateWhere;
  return {
    en: `Rotate the key now: ${where.en}.`,
    ur: `Key abhi rotate karein: ${where.ur}.`,
  };
}
