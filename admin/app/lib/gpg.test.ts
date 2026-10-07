import { describe, expect, it } from 'vitest';
import { createdFingerprint, signedCount } from './gpg';

describe('signedCount', () => {
  it('reads the count sign-releases.sh reports', () => {
    expect(signedCount("[2026-10-06 21:50:56] Signed 3 Release file(s) for host 'deb.debian.org' with ABC.\n")).toBe(3);
  });
  it('is 0 when the host is not mirrored yet', () => {
    expect(signedCount("[2026-10-06 21:50:56] Mirror root for 'x.org' not found at /m/x.org, skipping.\n")).toBe(0);
    expect(signedCount('')).toBe(0);
  });
});

describe('createdFingerprint', () => {
  it('reads the fingerprint of the key gpg created', () => {
    const out = '[GNUPG:] KEY_CONSIDERED X 0\n[GNUPG:] KEY_CREATED P 0123456789ABCDEF0123456789ABCDEF01234567\n';
    expect(createdFingerprint(out)).toBe('0123456789ABCDEF0123456789ABCDEF01234567');
  });
  it('is null without a KEY_CREATED line', () => {
    expect(createdFingerprint('[GNUPG:] PROGRESS\n')).toBeNull();
  });
});
