/** A single byte range of a file, inclusive. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * The single range a `Range` header asks for within a file of `size` bytes: a range,
 * 'unsatisfiable' (answer 416), or null to send the whole file (no header, a malformed one,
 * or several ranges, which are not supported).
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=\s*(\d*)-(\d*)\s*$/.exec(header);
  if (!match) return null;
  const [, first, last] = match;
  if (!first && !last) return null;
  let start: number;
  let end: number;
  if (!first) {
    // bytes=-N: the last N bytes
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last ? Math.min(Number(last), size - 1) : size - 1;
    if (last && Number(last) < start) return null;
  }
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}
