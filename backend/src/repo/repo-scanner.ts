import { scanForKeyHits, type KeyKind } from '../stages/site-rules.js';
import { REPO_SCAN_LIMITS, type RepoScanLimits } from './repo-limits.js';
import { readZip, stripRootFolder, ZipError } from './zip-reader.js';

/**
 * How the scanner gets the zip of a repository. This is the ONLY part that
 * talks to GitHub, so it can be changed (a plain archive address, or the REST
 * zipball with a token) without touching the scanner. A real one must:
 *  - stop reading after `maxBytes` and throw RepoFetchError('TOO_LARGE'),
 *  - never log or return a token, and never send it to any host but GitHub's API,
 *  - throw RepoFetchError for every other failure, with a fixed message.
 */
export interface RepoTransport {
  fetchArchive(
    repo: RepoRef,
    options: { maxBytes: number; signal?: AbortSignal },
  ): Promise<Buffer>;
}

/** A public GitHub repository. `ref` empty = the default branch. */
export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export type RepoFetchErrorCode =
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TOO_LARGE'
  | 'FAILED';

export class RepoFetchError extends Error {
  constructor(
    readonly code: RepoFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepoFetchError';
  }
}

/** A key kind found in one file. Never the key itself. */
export interface RepoHit {
  path: string;
  kind: KeyKind;
  /** the 1-based line of the first key of this kind in the file */
  line: number;
}

export type RepoNotReadReason =
  | 'too-large'
  | 'symlink'
  | 'binary'
  | 'archive-refused'
  | 'could-not-fetch'
  | 'not-found'
  | 'rate-limited';

export interface RepoScanOutcome {
  /** false when the zip could not be taken in at all */
  completed: boolean;
  /** why, when `completed` is false (one fixed code, never the library text) */
  failure?: RepoNotReadReason;
  hits: RepoHit[];
  /** files that were looked at */
  filesScanned: number;
  /** files that were NOT read, and why */
  notRead: { path: string; reason: RepoNotReadReason }[];
  /** every path that was read (used by later rules, never shown as is) */
  paths: string[];
}

// Folders that hold other people's code, not the repository's own.
const SKIP_FOLDERS = /(^|\/)(node_modules|\.git|dist|build|\.next|vendor)\//;
const TEXT_FILE =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|env|ini|cfg|conf|sql|md|txt|html?|sh|py|rb|go|php|properties)$|(^|\/)\.env[^/]*$|(^|\/)(?:Dockerfile|Makefile)$/i;

/** Which files are read at all (by name, before any are unpacked). */
export function isScannable(path: string): boolean {
  return !SKIP_FOLDERS.test(path) && TEXT_FILE.test(path);
}

/** A file with a NUL byte near the start is binary, not text. */
const looksBinary = (data: Buffer) => data.subarray(0, 1024).includes(0);

/**
 * Takes the zip of a repository from the transport and looks for Supabase
 * secret keys in its text files. Plain code: no model. A key is never copied
 * anywhere (only its kind and the file's path). Never throws: a failure is
 * an outcome with a fixed reason.
 */
export async function scanRepo(
  transport: RepoTransport,
  repo: RepoRef,
  options: { limits?: RepoScanLimits; signal?: AbortSignal } = {},
): Promise<RepoScanOutcome> {
  const limits = options.limits ?? REPO_SCAN_LIMITS;
  const empty = (failure: RepoNotReadReason): RepoScanOutcome => ({
    completed: false,
    failure,
    hits: [],
    filesScanned: 0,
    notRead: [],
    paths: [],
  });

  let zip: Buffer;
  try {
    zip = await transport.fetchArchive(repo, {
      maxBytes: limits.maxCompressedBytes,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof RepoFetchError) {
      return empty(
        error.code === 'TOO_LARGE'
          ? 'too-large'
          : error.code === 'NOT_FOUND'
            ? 'not-found'
            : error.code === 'RATE_LIMITED'
              ? 'rate-limited'
              : 'could-not-fetch',
      );
    }
    return empty('could-not-fetch');
  }

  let contents;
  try {
    contents = readZip(zip, limits, (path) => isScannable(stripRootFolder(path)));
  } catch (error) {
    if (error instanceof ZipError) return empty('archive-refused');
    return empty('archive-refused');
  }

  const hits: RepoHit[] = [];
  const notRead: RepoScanOutcome['notRead'] = contents.skipped.map((s) => ({
    path: stripRootFolder(s.path),
    reason: s.reason,
  }));
  const paths: string[] = [];
  let filesScanned = 0;
  for (const file of contents.files) {
    const path = stripRootFolder(file.path);
    if (looksBinary(file.data)) {
      notRead.push({ path, reason: 'binary' });
      continue;
    }
    filesScanned += 1;
    paths.push(path);
    for (const hit of scanForKeyHits(file.data.toString('utf8'))) {
      hits.push({ path, kind: hit.kind, line: hit.line });
    }
  }
  return { completed: true, hits, filesScanned, notRead, paths };
}
