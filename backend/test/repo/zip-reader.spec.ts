import { deflateRawSync } from 'node:zlib';
import { REPO_SCAN_LIMITS, type RepoScanLimits } from '../../src/repo/repo-limits.js';
import {
  readZip,
  stripRootFolder,
  ZipError,
  type ZipErrorCode,
} from '../../src/repo/zip-reader.js';
import { buildZip } from './zip-builder.js';

const LIMITS: RepoScanLimits = REPO_SCAN_LIMITS;

function codeOf(run: () => unknown): ZipErrorCode | 'no error' {
  try {
    run();
  } catch (error) {
    if (error instanceof ZipError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('the limits are the agreed ones', () => {
  it('has the numbers from the plan', () => {
    expect(LIMITS).toEqual({
      maxCompressedBytes: 15 * 1024 * 1024,
      maxUncompressedBytes: 40 * 1024 * 1024,
      maxEntries: 3000,
      maxFileBytes: 1024 * 1024,
    });
  });
});

describe('readZip: a normal zip', () => {
  it('reads files, skips folders, keeps stored and deflated files', () => {
    const zip = buildZip([
      { name: 'owner-repo-abc/' },
      { name: 'owner-repo-abc/src/a.ts', data: 'const a = 1;' },
      { name: 'owner-repo-abc/b.txt', data: 'plain', method: 0 },
    ]);
    const result = readZip(zip, LIMITS);
    expect(result.files.map((f) => [f.path, f.data.toString()])).toEqual([
      ['owner-repo-abc/src/a.ts', 'const a = 1;'],
      ['owner-repo-abc/b.txt', 'plain'],
    ]);
    expect(result.entries).toBe(3);
    expect(stripRootFolder('owner-repo-abc/src/a.ts')).toBe('src/a.ts');
  });

  it('does not unpack a file that is not wanted', () => {
    const zip = buildZip([
      { name: 'r/a.ts', data: 'x' },
      { name: 'r/logo.png', data: 'y' },
    ]);
    const result = readZip(zip, LIMITS, (p) => p.endsWith('.ts'));
    expect(result.files.map((f) => f.path)).toEqual(['r/a.ts']);
  });

  it('lists a file over the per-file limit as skipped, and goes on', () => {
    const zip = buildZip([
      { name: 'r/big.js', data: Buffer.alloc(LIMITS.maxFileBytes + 1, 97) },
      { name: 'r/small.js', data: 'ok' },
    ]);
    const result = readZip(zip, LIMITS);
    expect(result.skipped).toEqual([{ path: 'r/big.js', reason: 'too-large' }]);
    expect(result.files.map((f) => f.path)).toEqual(['r/small.js']);
  });
});

// The five tests asked for first.
describe('readZip: hostile and broken zips are refused', () => {
  it('1. path traversal: .., absolute, backslash, drive letter, NUL', () => {
    for (const name of [
      'r/../../etc/passwd',
      '../evil.js',
      '/etc/passwd',
      'r\\..\\evil.js',
      'C:/Windows/evil.js',
      'r/a\0.js',
    ]) {
      expect(codeOf(() => readZip(buildZip([{ name, data: 'x' }]), LIMITS))).toBe(
        'TRAVERSAL',
      );
    }
  });

  it('2. zip bomb: declared total over the cap, and a lie about the size', () => {
    // declared total over 40 MB (the zip itself is tiny: it is never unpacked)
    const declared = buildZip([
      { name: 'r/a.js', data: 'x', declaredSize: 900 * 1024 },
      ...Array.from({ length: 50 }, (_, i) => ({
        name: `r/f${i}.js`,
        data: 'x',
        declaredSize: 900 * 1024,
      })),
    ]);
    expect(codeOf(() => readZip(declared, LIMITS))).toBe('BOMB');

    // a real bomb: declares 10 bytes, unpacks to 1 MB
    const lie = buildZip([
      { name: 'r/a.js', data: Buffer.alloc(1024 * 1024, 0), declaredSize: 10 },
    ]);
    expect(codeOf(() => readZip(lie, LIMITS))).toBe('BOMB');
    // a real bomb is also small on the wire
    expect(deflateRawSync(Buffer.alloc(1024 * 1024)).length).toBeLessThan(2000);

    // a zip bigger than the compressed cap is refused before it is read
    expect(
      codeOf(() => readZip(Buffer.alloc(LIMITS.maxCompressedBytes + 1), LIMITS)),
    ).toBe('BOMB');
  });

  it('3. too many entries', () => {
    const many = buildZip(
      Array.from({ length: LIMITS.maxEntries + 1 }, (_, i) => ({
        name: `r/f${i}.txt`,
        data: '',
        method: 0,
      })),
    );
    expect(codeOf(() => readZip(many, LIMITS))).toBe('TOO_MANY_ENTRIES');
    // exactly at the limit is fine
    const exact = buildZip(
      Array.from({ length: LIMITS.maxEntries }, (_, i) => ({
        name: `r/f${i}.txt`,
        data: '',
        method: 0,
      })),
    );
    expect(codeOf(() => readZip(exact, LIMITS))).toBe('no error');
  });

  it('4. truncated: cut off, empty, not a zip, end record lying', () => {
    const zip = buildZip([{ name: 'r/a.js', data: 'hello world'.repeat(50) }]);
    expect(codeOf(() => readZip(zip.subarray(0, zip.length - 30), LIMITS))).toBe(
      'TRUNCATED',
    );
    expect(codeOf(() => readZip(zip.subarray(0, 40), LIMITS))).toBe('TRUNCATED');
    expect(codeOf(() => readZip(Buffer.alloc(0), LIMITS))).toBe('TRUNCATED');
    expect(codeOf(() => readZip(Buffer.from('not a zip at all'), LIMITS))).toBe(
      'TRUNCATED',
    );
    // the index says one more file than there is: damaged, not a crash
    const lying = buildZip([{ name: 'r/a.js', data: 'x' }], { countOverride: 2 });
    expect(['CORRUPT', 'TRUNCATED']).toContain(codeOf(() => readZip(lying, LIMITS)));
  });

  it('5. zip64, encrypted and symlink', () => {
    expect(
      codeOf(() =>
        readZip(buildZip([{ name: 'r/a.js', data: 'x' }], { zip64Locator: true }), LIMITS),
      ),
    ).toBe('UNSUPPORTED');
    expect(
      codeOf(() =>
        readZip(buildZip([{ name: 'r/a.js', data: 'x' }], { zip64Count: true }), LIMITS),
      ),
    ).toBe('UNSUPPORTED');
    // encrypted entry
    expect(
      codeOf(() =>
        readZip(buildZip([{ name: 'r/a.js', data: 'x', flags: 1 }]), LIMITS),
      ),
    ).toBe('UNSUPPORTED');
    // a symlink is never unpacked or followed: that entry is listed, the rest is read
    const withLink = buildZip([
      { name: 'r/link', data: '../../etc/passwd', mode: 0o120777 },
      { name: 'r/a.js', data: 'ok', mode: 0o100644 },
    ]);
    const result = readZip(withLink, LIMITS);
    expect(result.skipped).toEqual([{ path: 'r/link', reason: 'symlink' }]);
    expect(result.files.map((f) => f.path)).toEqual(['r/a.js']);
  });
});
