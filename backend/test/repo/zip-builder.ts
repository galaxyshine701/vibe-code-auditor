import { deflateRawSync } from 'node:zlib';

/** Test-only: builds small zips by hand, including broken and hostile ones. */
export interface TestEntry {
  name: string;
  data?: Buffer | string;
  /** 0 = stored, 8 = deflate (default 8) */
  method?: number;
  /** general purpose flags (1 = encrypted) */
  flags?: number;
  /** unix file mode, for example 0o120777 for a symlink */
  mode?: number;
  /** a lie in the central index about the unpacked size */
  declaredSize?: number;
}

export interface BuildOptions {
  /** put a zip64 locator before the end record */
  zip64Locator?: boolean;
  /** write 0xFFFF as the entry count (zip64 marker) */
  zip64Count?: boolean;
  /** the count written in the end record (default: real) */
  countOverride?: number;
}

export function buildZip(
  entries: TestEntry[],
  options: BuildOptions = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data ?? '');
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const flags = entry.flags ?? 0;
    const size = entry.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((entry.mode ? 3 : 0) << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = options.zip64Count
    ? 0xffff
    : (options.countOverride ?? entries.length);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const parts = [...locals, centralBuffer];
  if (options.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    parts.push(locator);
  }
  parts.push(eocd);
  return Buffer.concat(parts);
}
