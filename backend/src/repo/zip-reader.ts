import { inflateRawSync } from 'node:zlib';
import type { RepoScanLimits } from './repo-limits.js';

/**
 * A small, strict zip reader for Repo Scan. It reads from memory only (it never
 * writes a file, so a path inside the zip can not escape anywhere), and it
 * refuses what a repository zip never needs:
 *  - a path with "..", an absolute path, a backslash or a NUL (TRAVERSAL)
 *  - zip64, encrypted entries, methods other than stored/deflate (UNSUPPORTED)
 *  - more entries than the limit, or a declared total over the limit, or an
 *    entry that unpacks to more than it declared (TOO_MANY_ENTRIES, BOMB)
 *  - a zip that is cut off or whose numbers do not fit (TRUNCATED, CORRUPT)
 * A symlink is never followed or unpacked; that one entry is listed as skipped.
 * A single file over the per-file limit is also listed as skipped, not an error.
 */
export type ZipErrorCode =
  | 'TRAVERSAL'
  | 'BOMB'
  | 'TOO_MANY_ENTRIES'
  | 'TRUNCATED'
  | 'CORRUPT'
  | 'UNSUPPORTED';

export class ZipError extends Error {
  constructor(
    readonly code: ZipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipFile {
  path: string;
  data: Buffer;
}

export interface ZipSkipped {
  path: string;
  reason: 'too-large' | 'symlink';
}

export interface ZipContents {
  files: ZipFile[];
  skipped: ZipSkipped[];
  /** entries in the zip, folders included */
  entries: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

function findEocd(zip: Buffer): number {
  const stop = Math.max(0, zip.length - EOCD_MIN - MAX_COMMENT);
  for (let i = zip.length - EOCD_MIN; i >= stop; i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new ZipError(
    'TRUNCATED',
    'The zip has no end record: it is cut off or not a zip.',
  );
}

/** Raises TRAVERSAL for any path a repository never has. */
function checkPath(name: string): void {
  if (
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((part) => part === '..')
  ) {
    throw new ZipError('TRAVERSAL', 'The zip has a path that is not allowed.');
  }
}

interface Entry {
  path: string;
  method: number;
  compressed: number;
  size: number;
  localOffset: number;
  symlink: boolean;
}

/**
 * Reads the zip. `wanted` (optional) says which files to unpack: an entry that
 * is not wanted is never unpacked (it still counts for the declared total).
 */
export function readZip(
  zip: Buffer,
  limits: RepoScanLimits,
  wanted: (path: string) => boolean = () => true,
): ZipContents {
  if (zip.length > limits.maxCompressedBytes) {
    throw new ZipError('BOMB', 'The zip is larger than the allowed size.');
  }
  const eocd = findEocd(zip);
  // zip64 = a locator right before the end record, or a field set to "see zip64"
  if (
    (eocd >= 20 && zip.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) ||
    zip.readUInt16LE(eocd + 10) === 0xffff ||
    zip.readUInt32LE(eocd + 12) === 0xffffffff ||
    zip.readUInt32LE(eocd + 16) === 0xffffffff
  ) {
    throw new ZipError('UNSUPPORTED', 'zip64 archives are not accepted.');
  }
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralStart = zip.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) {
    throw new ZipError('TOO_MANY_ENTRIES', 'The zip has too many entries.');
  }
  if (centralStart + centralSize > eocd) {
    throw new ZipError('TRUNCATED', 'The zip is cut off.');
  }

  const entries: Entry[] = [];
  let pos = centralStart;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || zip.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new ZipError('CORRUPT', 'The zip index is damaged.');
    }
    const madeBy = zip.readUInt16LE(pos + 4);
    const flags = zip.readUInt16LE(pos + 8);
    const method = zip.readUInt16LE(pos + 10);
    const compressed = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const externalAttrs = zip.readUInt32LE(pos + 38);
    const localOffset = zip.readUInt32LE(pos + 42);
    const end = pos + 46 + nameLen + extraLen + commentLen;
    if (end > eocd) throw new ZipError('CORRUPT', 'The zip index is damaged.');
    const path = zip.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos = end;

    if (flags & 0x1 || flags & 0x40) {
      throw new ZipError('UNSUPPORTED', 'Encrypted zips are not accepted.');
    }
    if (compressed === 0xffffffff || size === 0xffffffff) {
      throw new ZipError('UNSUPPORTED', 'zip64 archives are not accepted.');
    }
    checkPath(path);
    if (path.endsWith('/')) continue; // a folder
    if (method !== 0 && method !== 8) {
      throw new ZipError('UNSUPPORTED', 'This zip uses an unsupported method.');
    }
    declaredTotal += size;
    if (declaredTotal > limits.maxUncompressedBytes) {
      throw new ZipError(
        'BOMB',
        'The zip unpacks to more than the allowed size.',
      );
    }
    // made by Unix (3): the top 16 bits of the attributes are the file mode
    const symlink =
      madeBy >> 8 === 3 && ((externalAttrs >>> 16) & 0xf000) === 0xa000;
    entries.push({ path, method, compressed, size, localOffset, symlink });
  }

  const files: ZipFile[] = [];
  const skipped: ZipSkipped[] = [];
  let actualTotal = 0;
  for (const entry of entries) {
    if (entry.symlink) {
      skipped.push({ path: entry.path, reason: 'symlink' });
      continue;
    }
    if (entry.size > limits.maxFileBytes) {
      skipped.push({ path: entry.path, reason: 'too-large' });
      continue;
    }
    if (!wanted(entry.path)) continue;

    const at = entry.localOffset;
    if (at + 30 > zip.length || zip.readUInt32LE(at) !== SIG_LOCAL) {
      throw new ZipError('CORRUPT', 'The zip has a damaged file header.');
    }
    const start =
      at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28);
    const stop = start + entry.compressed;
    if (stop > zip.length) {
      throw new ZipError('TRUNCATED', 'The zip is cut off inside a file.');
    }
    const raw = zip.subarray(start, stop);
    let data: Buffer;
    if (entry.method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        // never let one entry unpack to more than it declared (+1 to notice it)
        data = inflateRawSync(raw, { maxOutputLength: entry.size + 1 });
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw code === 'ERR_BUFFER_TOO_LARGE'
          ? new ZipError('BOMB', 'A file unpacks to more than it declared.')
          : new ZipError('CORRUPT', 'A file in the zip could not be unpacked.');
      }
    }
    if (data.length !== entry.size) {
      throw new ZipError('CORRUPT', 'A file does not match its declared size.');
    }
    actualTotal += data.length;
    if (actualTotal > limits.maxUncompressedBytes) {
      throw new ZipError(
        'BOMB',
        'The zip unpacks to more than the allowed size.',
      );
    }
    files.push({ path: entry.path, data });
  }
  return { files, skipped, entries: count };
}

/** GitHub puts everything under one folder (owner-repo-sha/). Removes it. */
export function stripRootFolder(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
