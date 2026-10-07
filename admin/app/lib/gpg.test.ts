import { describe, expect, it } from 'vitest';
import { assertValidHost, createdFingerprint, isSignableHost, signedCount, unrestoredCount } from './gpg';

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

describe('unrestoredCount', () => {
  it('reads how many Release files kept our signature', () => {
    const out =
      "[2026-10-07 10:00:00] Restored upstream signatures of 1 Release file(s) for host 'deb.debian.org'.\n" +
      "[2026-10-07 10:00:00] Not restored: 2 Release file(s) for host 'deb.debian.org'.\n";
    expect(unrestoredCount(out)).toBe(2);
  });
  it('is 0 when every Release file was restored', () => {
    expect(unrestoredCount("[x] Restored upstream signatures of 2 Release file(s) for host 'a.org'.\n")).toBe(0);
  });
});

describe('isSignableHost and assertValidHost', () => {
  it.each(['deb.debian.org', 'aptly', 'localhost', '192.168.0.10', 'my-repo'])('accepts %s', (host) => {
    expect(isSignableHost(host)).toBe(true);
    expect(() => assertValidHost(host)).not.toThrow();
  });
  it.each(['', '-aptly', 'apt_ly', 'a..b', 'host:8080', '../etc', 'a b'])('refuses %j', (host) => {
    expect(isSignableHost(host)).toBe(false);
    expect(() => assertValidHost(host)).toThrow(/Invalid host/);
  });
  it('says why an IPv6 address host cannot be signed', () => {
    expect(isSignableHost('[fd00::10]')).toBe(false);
    expect(() => assertValidHost('[fd00::10]')).toThrow(/not supported for IPv6 address hosts/);
  });
});
