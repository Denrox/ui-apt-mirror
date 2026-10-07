import { describe, it, expect } from 'vitest';
import { isHashablePassword, passwordError, usernameError } from './password-rules';

describe('passwordError', () => {
  it('refuses passwords shorter than the minimum', () => {
    expect(passwordError('')).toMatch(/at least 4/);
    expect(passwordError('abc')).toMatch(/at least 4/);
  });

  it('accepts passwords of the minimum length or longer', () => {
    expect(passwordError('abcd')).toBeNull();
    expect(passwordError('a-longer-password')).toBeNull();
  });
});

describe('passwords openssl would not store as typed', () => {
  it('refuses line breaks and other control characters', () => {
    expect(passwordError('Long\nSecretPart')).toMatch(/control characters/);
    expect(passwordError('\nabcd')).toMatch(/control characters/);
    expect(passwordError('ab\nxxxx')).toMatch(/control characters/);
    expect(passwordError('tab\there')).toMatch(/control characters/);
    expect(isHashablePassword('Long\nSecretPart')).toBe(false);
  });

  it('refuses passwords over 256 bytes', () => {
    expect(passwordError('k'.repeat(256))).toBeNull();
    expect(passwordError('k'.repeat(257))).toMatch(/too long/);
    expect(passwordError('é'.repeat(129))).toMatch(/too long/);
    expect(isHashablePassword('k'.repeat(300))).toBe(false);
  });

  it('accepts spaces, backslashes and non-ASCII', () => {
    expect(passwordError(' p\\ss wörd ')).toBeNull();
  });
});

describe('usernameError', () => {
  it('accepts the allowed characters up to 64', () => {
    expect(usernameError('bob_the-2nd')).toBeNull();
    expect(usernameError('u'.repeat(64))).toBeNull();
  });

  it('refuses long, empty or odd names', () => {
    expect(usernameError('u'.repeat(65))).toMatch(/at most 64/);
    expect(usernameError('u'.repeat(20008))).toMatch(/at most 64/);
    expect(usernameError('')).not.toBeNull();
    expect(usernameError('admin ')).not.toBeNull();
    expect(usernameError('x 1\nvictim 99999999999999')).not.toBeNull();
    expect(usernameError('u'.repeat(65), { anyLength: true })).toBeNull();
    expect(usernameError('x 1\nvictim 1', { anyLength: true })).not.toBeNull();
  });
});
