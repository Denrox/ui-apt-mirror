import { describe, it, expect } from 'vitest';
import { passwordError, usernameError } from './password-rules';

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
