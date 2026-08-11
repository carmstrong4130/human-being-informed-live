/**
 * A read-only tar reader, just enough for GitHub's `codeload` tarballs.
 *
 * Deliberately dependency-free: the data fetchers are run by scheduled CI with
 * no install step, so everything they need has to come from Node's standard
 * library. Tar is a simple format — 512-byte header, then the file's bytes
 * padded to the next 512-byte boundary — and the only wrinkles that show up in
 * a git archive are the two long-path mechanisms, both handled below.
 */

export interface TarEntry {
  path: string;
  data: Buffer;
}

const BLOCK = 512;

/** Octal header fields are ASCII, NUL- or space-padded. GNU base-256 is also accepted. */
function readSize(header: Buffer): number {
  // High bit set means GNU base-256 encoding rather than octal.
  if ((header[124] ?? 0) & 0x80) {
    let value = 0;
    for (let i = 125; i < 136; i += 1) value = value * 256 + (header[i] ?? 0);
    return value;
  }
  const text = header.toString("ascii", 124, 136).replace(/\0/g, "").trim();
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readString(header: Buffer, start: number, end: number): string {
  const raw = header.toString("utf8", start, end);
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

/** pax records are "<length> <key>=<value>\n", length counting the whole record. */
function paxPath(data: Buffer): string | null {
  const text = data.toString("utf8");
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length).replace(/\n$/, "");
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === "path") return record.slice(eq + 1);
    offset += length;
  }
  return null;
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

/**
 * Yields the regular files in an uncompressed tar buffer. Directories, symlinks
 * and metadata entries are skipped; `data` is a view into `raw`, not a copy.
 */
export function* readTar(raw: Buffer): Generator<TarEntry> {
  let offset = 0;
  // Set by an immediately preceding pax ('x') or GNU long-name ('L') entry.
  let pendingPath: string | null = null;

  while (offset + BLOCK <= raw.length) {
    const header = raw.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break; // two zero blocks mark end of archive

    const size = readSize(header);
    const typeFlag = readString(header, 156, 157);
    const dataStart = offset + BLOCK;
    const dataEnd = Math.min(dataStart + size, raw.length);
    const data = raw.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === "x" || typeFlag === "X") {
      pendingPath = paxPath(data);
      continue;
    }
    if (typeFlag === "L") {
      pendingPath = data.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (typeFlag === "g") continue; // global pax header — not per-entry

    // "0" and the legacy "\0" are regular files; 5 = directory, 1/2 = links, etc.
    const isFile = typeFlag === "0" || typeFlag === "\0" || typeFlag === "";
    if (!isFile) {
      pendingPath = null;
      continue;
    }

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 500);
    const path = pendingPath ?? (prefix ? `${prefix}/${name}` : name);
    pendingPath = null;

    if (path === "" || path.endsWith("/")) continue;
    yield { path, data };
  }
}
