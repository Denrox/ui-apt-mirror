import { describe, it, expect } from 'vitest';
import { initialSourcesOpen } from './sources-open';

describe('initialSourcesOpen', () => {
  it('shows the Add form when there are no sources', () => {
    expect(initialSourcesOpen(false, 0, false)).toBe(true);
  });

  it('keeps the choice remembered in this browser', () => {
    expect(initialSourcesOpen(false, 2, true)).toBe(false);
    expect(initialSourcesOpen(true, 30, false)).toBe(true);
  });

  it('by default collapses on phones, and on desktop once there are many sources', () => {
    expect(initialSourcesOpen(null, 2, false)).toBe(false);
    expect(initialSourcesOpen(null, 2, true)).toBe(true);
    expect(initialSourcesOpen(null, 19, true)).toBe(false);
  });
});
