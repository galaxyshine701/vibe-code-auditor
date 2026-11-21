import { createGithubTransport } from './github-transport.js';
import type { RepoTransport } from './repo-scanner.js';

export const REPO_SETUP = Symbol('REPO_SETUP');

/**
 * How Repo Scan reaches GitHub. Built once from the environment.
 * `secrets` are texts that must never appear in any output (they go through
 * the same redaction as the keys of an audit).
 */
export interface RepoSetup {
  transport: RepoTransport;
  secrets: string[];
}

/**
 * GITHUB_TOKEN is optional (a fine-grained token with no scopes). It is only
 * used when set; without it the plain archive address is used. The token is
 * never logged: nothing here prints a value.
 */
export function resolveRepoSetup(env: NodeJS.ProcessEnv): RepoSetup {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  return {
    transport: createGithubTransport({ token }),
    secrets: token ? [token] : [],
  };
}
