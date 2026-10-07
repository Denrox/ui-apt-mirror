import { describe, it, expect } from 'vitest';
import { pageOf } from './loader';

describe('pageOf (r2-files-8)', () => {
  const items = Array.from({ length: 450 }, (_, i) => i);

  it('returns one page and the page count', () => {
    expect(pageOf(items, 1, 200)).toMatchObject({ page: 1, pageCount: 3, total: 450 });
    expect(pageOf(items, 1, 200).items).toHaveLength(200);
    expect(pageOf(items, 3, 200).items).toEqual(items.slice(400));
  });

  it('clamps out-of-range and invalid pages', () => {
    expect(pageOf(items, 9, 200).page).toBe(3);
    expect(pageOf(items, 0, 200).page).toBe(1);
    expect(pageOf(items, Number.NaN, 200).page).toBe(1);
    expect(pageOf([], 1, 200)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});
