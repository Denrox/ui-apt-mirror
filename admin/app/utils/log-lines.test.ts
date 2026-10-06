import { describe, it, expect } from 'vitest';
import { filterLogLines, splitLogLines } from './log-lines';

describe('splitLogLines', () => {
  it('has no lines for an empty log', () => {
    expect(splitLogLines('')).toEqual([]);
  });

  it('does not count the final newline as a line', () => {
    expect(splitLogLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLogLines('a\r\nb')).toEqual(['a', 'b']);
    expect(splitLogLines('\n')).toEqual(['']);
  });
});

describe('filterLogLines', () => {
  const log =
    'plain line\nINFO started\nWARNING slow\nERROR failed\nDEBUG detail\n';

  it('counts unlabelled lines as INFO', () => {
    expect(filterLogLines(log, '', 'INFO').map((l) => l.text)).toEqual([
      'plain line',
      'INFO started',
    ]);
  });

  it('filters by level and search, keeping line numbers', () => {
    expect(filterLogLines(log, 'fail', 'ALL')).toEqual([
      { text: 'ERROR failed', level: 'ERROR', n: 4 },
    ]);
    expect(filterLogLines(log, '', 'WARN').map((l) => l.n)).toEqual([3]);
    expect(filterLogLines(log, '', 'ALL')).toHaveLength(5);
  });
});
