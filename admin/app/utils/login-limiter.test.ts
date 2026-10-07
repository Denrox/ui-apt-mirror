import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginLoginAttempt,
  loginSucceeded,
  resetLoginLimiter,
  tooManyAttemptsMessage,
} from './login-limiter';

const MIN = 60 * 1000;

beforeEach(() => resetLoginLimiter());

function fail(ip: string, user: string, times: number, now = 0) {
  for (let i = 0; i < times; i++)
    expect(beginLoginAttempt(ip, user, now)).toBe(0);
}

describe('login limiter', () => {
  it('blocks the sixth attempt from one IP for 15 minutes', () => {
    fail('1.1.1.1', 'admin', 5);
    expect(beginLoginAttempt('1.1.1.1', 'admin', 0)).toBe(15 * 60);
    expect(beginLoginAttempt('1.1.1.1', 'other', MIN)).toBe(14 * 60);
    expect(beginLoginAttempt('1.1.1.1', 'admin', 15 * MIN + 1)).toBe(0);
  });

  it('does not let one IP lock a user out on another IP', () => {
    fail('10.0.0.1', 'admin', 5);
    expect(beginLoginAttempt('10.0.0.1', 'admin', 0)).toBeGreaterThan(0);
    expect(beginLoginAttempt('10.0.0.2', 'admin', 0)).toBe(0);
  });

  it('limits a username guessed from many IPs', () => {
    for (let i = 0; i < 20; i++) fail(`10.0.0.${i}`, 'admin', 1);
    expect(beginLoginAttempt('10.0.1.1', 'admin', 0)).toBe(15 * 60);
    expect(beginLoginAttempt('10.0.1.1', 'bob', 0)).toBe(0);
  });

  it('never applies the username limit to an IP the user signed in from', () => {
    expect(beginLoginAttempt('192.168.1.5', 'admin', 0)).toBe(0);
    loginSucceeded('192.168.1.5', 'admin', 0);
    for (let i = 0; i < 20; i++) fail(`10.0.${i}.1`, 'admin', 1, MIN);
    expect(beginLoginAttempt('10.0.99.1', 'admin', MIN)).toBeGreaterThan(0);
    expect(beginLoginAttempt('192.168.1.5', 'admin', MIN)).toBe(0);
  });

  it('resets on success', () => {
    fail('1.1.1.1', 'admin', 4);
    loginSucceeded('1.1.1.1', 'admin');
    fail('1.1.1.1', 'admin', 5);
  });

  it('says how long to wait', () => {
    expect(tooManyAttemptsMessage(15 * 60)).toBe(
      'Too many failed login attempts. Try again in 15 minutes.',
    );
    expect(tooManyAttemptsMessage(10)).toContain('in 1 minute.');
  });
});
