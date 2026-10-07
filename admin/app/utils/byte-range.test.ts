import { describe, it, expect } from 'vitest';
import { parseRange } from './byte-range';

describe('parseRange (r3-files-12)', () => {
  it.each([
    ['bytes=100-199', { start: 100, end: 199 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=990-5000', { start: 990, end: 999 }],
    ['bytes=0-0', { start: 0, end: 0 }],
  ])('%s', (header, range) => {
    expect(parseRange(header, 1000)).toEqual(range);
  });

  it('answers unsatisfiable past the end', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('ignores missing, malformed and multiple ranges', () => {
    for (const header of [null, '', 'bytes=', 'bytes=-', 'items=0-1', 'bytes=0-1,5-6', 'bytes=9-3', 'bytes=a-b']) {
      expect(parseRange(header, 1000)).toBeNull();
    }
  });
});
