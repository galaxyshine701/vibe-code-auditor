import type { Lang } from './check-labels';

// The messages the page itself writes (errors, the rate limit, the access code),
// in Roman Urdu. A message of the server that is not listed is shown as it came.
const UR: Record<string, string> = {
  'Cannot reach the server. Check your connection and try again.':
    'Server tak pohanch nahi ho saki. Apna connection check karke dobara koshish karein.',
  'Enter the access code to continue. It stays in this page’s memory only.':
    'Aage barhne ke liye access code likhein. Ye sirf is page ki memory mein rehta hai.',
  'Enter the access code to read this report. It stays in this page’s memory only.':
    'Report parhne ke liye access code likhein. Ye sirf is page ki memory mein rehta hai.',
  'Enter the access code to see this audit. It stays in this page’s memory only.':
    'Ye audit dekhne ke liye access code likhein. Ye sirf is page ki memory mein rehta hai.',
  'Access code': 'Access code',
  Continue: 'Aage barhein',
  'Start a new audit': 'Naya audit shuru karein',
  'Something went wrong. Please try again.':
    'Kuch ghalat ho gaya. Dobara koshish karein.',
  'Access denied.': 'Ijazat nahi mili.',
  'Enter the access code.': 'Access code likhein.',
  'Access code required': 'Access code chahiye',
  Retry: 'Dobara koshish',
};

export function uiText(message: string, lang: Lang): string {
  if (lang !== 'ur') return message;
  if (UR[message]) return UR[message];
  const status = /^The server answered with status (\d+)\.$/.exec(message);
  if (status) return `Server ne status ${status[1]} ke saath jawab diya.`;
  return message;
}

export function rateLimitText(seconds: number, lang: Lang): string {
  return lang === 'ur'
    ? `Bohat si ghalat koshishein. ${seconds}s baad dobara koshish karein.`
    : `Too many wrong attempts. Try again in ${seconds}s.`;
}
