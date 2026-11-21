/** How much of a repository the Repo Scan may take in. Plain numbers from code. */
export interface RepoScanLimits {
  /** the zip as downloaded */
  maxCompressedBytes: number;
  /** all files together, as the zip itself declares them, after unpacking */
  maxUncompressedBytes: number;
  /** most entries (files and folders) in the zip */
  maxEntries: number;
  /** most bytes of ONE file, after unpacking; a bigger file is left unread */
  maxFileBytes: number;
}

export const REPO_SCAN_LIMITS: RepoScanLimits = {
  maxCompressedBytes: 15 * 1024 * 1024,
  maxUncompressedBytes: 40 * 1024 * 1024,
  maxEntries: 3000,
  maxFileBytes: 1024 * 1024,
};

/** Repo scans that may run at the same time. */
export const REPO_SCAN_CONCURRENCY = 1;
