import { describe, it, expect } from 'vitest';
import { formatDateTime } from './use-hydrated';

describe('formatDateTime', () => {
  it('renders a time-zone independent UTC value before hydration', () => {
    expect(formatDateTime('2026-10-06T17:14:40.123Z', false)).toBe('2026-10-06 17:14 UTC');
    expect(formatDateTime(new Date(Date.UTC(2026, 0, 2, 3, 4)), false)).toBe('2026-01-02 03:04 UTC');
  });

  it('renders local time afterwards and nothing for invalid dates', () => {
    expect(formatDateTime('2026-10-06T17:14:40Z', true)).toMatch(/\d{2}:\d{2}$/);
    expect(formatDateTime('garbage', true)).toBe('');
  });
});
