import { describe, expect, it, vi } from 'vitest';

vi.mock('~/config/config.json', () => ({ default: { hosts: [{ id: 'mirror', address: 'mirror.intra' }] } }));
vi.mock('~/utils/auth-middleware', () => ({ requireAuthMiddleware: async () => undefined }));

const { filterNote } = await import('./loader');

describe('filterNote (r3-repos-3)', () => {
  it('is empty for an unfiltered repository alone on its upstream', () => {
    expect(filterNote(false, [])).toEqual([]);
    expect(filterNote(false, [{ title: 'Other', filtered: false }])).toEqual([]);
  });

  it('marks an unfiltered repository that another one filters, naming it', () => {
    const note = filterNote(false, [{ title: 'Trixie hello', filtered: true }]).join('\n');
    expect(note).toMatch(/^# Filtered mirror/);
    expect(note).toContain('the filter of "Trixie hello" (same');
  });

  it('tells a filtered repository which others its filter restricts or joins', () => {
    const note = filterNote(true, [
      { title: 'Updates', filtered: false },
      { title: 'Tools', filtered: true },
    ]).join('\n');
    expect(note).toContain('This filter also restricts "Updates"');
    expect(note).toContain('The filters of "Tools" (same upstream) are combined');
  });
});

describe('commentLines', () => {
  it('wraps a message into short comment lines', async () => {
    const { commentLines } = await import('./loader');
    const lines = commentLines(`${'word '.repeat(40)}end`);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.startsWith('# ') && l.length <= 95)).toBe(true);
    expect(lines.join(' ').replace(/# /g, '')).toBe(`${'word '.repeat(40)}end`);
    expect(commentLines('')).toEqual([]);
  });
});
