import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// See the landing block at the top of upgrade.sh.
const RELEASED_UPGRADE_SH_SIZES = [8192];

describe('upgrade.sh landing block', () => {
  const script = readFileSync(path.resolve(__dirname, '../../../upgrade.sh'));

  it.each(RELEASED_UPGRADE_SH_SIZES)('has "exit 0" at byte %i', (offset) => {
    expect(script.subarray(offset, offset + 7).toString()).toBe('exit 0\n');
    expect(script[offset - 1]).toBe('\n'.charCodeAt(0));
  });

  it('keeps the block inside "if false" so normal runs skip it', () => {
    const text = script.toString();
    const start = text.indexOf('if false; then\n');
    const end = text.indexOf('\nfi\n', start);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(Math.min(...RELEASED_UPGRADE_SH_SIZES));
    expect(end).toBeGreaterThan(Math.max(...RELEASED_UPGRADE_SH_SIZES));
  });
});
