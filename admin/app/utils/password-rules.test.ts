import { describe, it, expect } from 'vitest';
import { passwordError } from './password-rules';

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
