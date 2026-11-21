import { RepoFetchError, type RepoRef, type RepoTransport } from './repo-scanner.js';

/**
 * The real RepoTransport. It talks to GitHub only, over https, on three fixed
 * hosts, and follows a redirect only to one of them (by hand, at most 3 hops).
 *
 *  - GITHUB_TOKEN set: REST  GET api.github.com/repos/{o}/{r}/zipball[/{ref}]
 *    The token is sent ONLY to api.github.com, never to codeload, never on a
 *    redirect to another host. Without a ref, GitHub answers with the default
 *    branch, so one scan is one API call and there is no metadata call.
 *  - no token: the plain web address  github.com/{o}/{r}/archive/{ref|HEAD}.zip
 *    (HEAD = the default branch). No API call, no rate limit of the API.
 *
 * The size is enforced while reading (the body is cut off at `maxBytes`). The
 * token is never logged, returned or put in an error. Errors carry fixed text
 * only: never the address, a header or the library's message.
 */
const API = 'api.github.com';
const ALLOWED_HOSTS = new Set([API, 'codeload.github.com', 'github.com']);
const MAX_HOPS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;

export interface GithubTransportOptions {
  /** fine-grained token without scopes; used only if non-empty */
  token?: string;
  timeoutMs?: number;
  /** for tests */
  fetchImpl?: typeof fetch;
}

export function createGithubTransport(
  options: GithubTransportOptions = {},
): RepoTransport {
  const token = (options.token ?? '').trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async fetchArchive(repo: RepoRef, { maxBytes, signal }) {
      const start = addressOf(repo, token !== '');
      const timeout = AbortSignal.timeout(timeoutMs);
      const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        let current = start;
        for (let hop = 0; hop <= MAX_HOPS; hop++) {
          const url = new URL(current);
          if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
            throw new RepoFetchError('FAILED', 'GitHub sent us somewhere not allowed.');
          }
          const headers: Record<string, string> = {
            'user-agent': 'vibe-code-auditor',
            accept: 'application/vnd.github+json',
          };
          if (token && url.hostname === API) {
            headers.authorization = `Bearer ${token}`;
          }
          const res = await doFetch(url, {
            headers,
            redirect: 'manual',
            signal: both,
          });
          if (res.status >= 300 && res.status < 400) {
            await res.body?.cancel();
            const location = res.headers.get('location');
            if (!location || hop === MAX_HOPS) {
              throw new RepoFetchError('FAILED', 'GitHub redirected us in a way we refuse.');
            }
            current = new URL(location, url).toString();
            continue;
          }
          if (res.status === 404) {
            await res.body?.cancel();
            throw new RepoFetchError('NOT_FOUND', 'The repository was not found, or it is private.');
          }
          if (res.status === 403 || res.status === 429) {
            await res.body?.cancel();
            throw new RepoFetchError('RATE_LIMITED', 'GitHub refused the request (rate limit or access).');
          }
          if (!res.ok || !res.body) {
            await res.body?.cancel();
            throw new RepoFetchError('FAILED', 'GitHub did not give the archive.');
          }
          const declared = Number(res.headers.get('content-length'));
          if (Number.isFinite(declared) && declared > maxBytes) {
            await res.body.cancel();
            throw new RepoFetchError('TOO_LARGE', 'The repository archive is larger than the allowed size.');
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of res.body) {
            total += chunk.length;
            if (total > maxBytes) {
              // leaving the loop by a throw cancels the stream by itself
              throw new RepoFetchError('TOO_LARGE', 'The repository archive is larger than the allowed size.');
            }
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks, total);
        }
        throw new RepoFetchError('FAILED', 'GitHub redirected us too many times.');
      } catch (error) {
        if (error instanceof RepoFetchError) throw error;
        // a timeout, a stop, a network error: one fixed sentence, nothing else
        throw new RepoFetchError('FAILED', 'GitHub could not be reached in time.');
      }
    },
  };
}

function addressOf(repo: RepoRef, useApi: boolean): string {
  if (!NAME.test(repo.owner) || !NAME.test(repo.repo)) {
    throw new RepoFetchError('FAILED', 'The repository name is not valid.');
  }
  if (repo.ref !== undefined && (!REF.test(repo.ref) || repo.ref.includes('..'))) {
    throw new RepoFetchError('FAILED', 'The branch name is not valid.');
  }
  const ref = repo.ref ? encodeURI(repo.ref) : undefined;
  return useApi
    ? `https://${API}/repos/${repo.owner}/${repo.repo}/zipball${ref ? `/${ref}` : ''}`
    : `https://github.com/${repo.owner}/${repo.repo}/archive/${ref ? `refs/heads/${ref}` : 'HEAD'}.zip`;
}
