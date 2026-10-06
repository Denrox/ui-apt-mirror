import { describe, expect, it } from 'vitest';
import { signedCount } from './gpg';

describe('signedCount', () => {
  it('reads the count sign-releases.sh reports', () => {
    expect(signedCount("[2026-10-06 21:50:56] Signed 3 Release file(s) for host 'deb.debian.org' with ABC.\n")).toBe(3);
  });
  it('is 0 when the host is not mirrored yet', () => {
    expect(signedCount("[2026-10-06 21:50:56] Mirror root for 'x.org' not found at /m/x.org, skipping.\n")).toBe(0);
    expect(signedCount('')).toBe(0);
  });
});
