import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginLoginAttempt,
  clientIp,
  isSharedAddress,
  loginSucceeded,
  parseDefaultGateways,
  resetLoginLimiter,
  tooManyAttemptsMessage,
} from './login-limiter';

const MIN = 60 * 1000;

const GATEWAY = '172.18.0.1';

beforeEach(() => resetLoginLimiter([GATEWAY]));

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
    loginSucceeded('1.1.1.1', 'admin', 0);
    fail('1.1.1.1', 'admin', 5);
  });

  it('forgives only the signing-in user\'s own failures', () => {
    fail('1.1.1.1', 'alice', 3);
    fail('1.1.1.1', 'admin', 1);
    loginSucceeded('1.1.1.1', 'alice', 0);
    fail('1.1.1.1', 'admin', 4); // admin's guess stays counted: 5 in all
    expect(beginLoginAttempt('1.1.1.1', 'alice', 0)).toBeGreaterThan(0);
  });

  it('does not let an account holder reset their address between guesses (r3-auth-2)', () => {
    // 4 guesses at the victim, then a correct login to the attacker's own account.
    fail('10.0.0.1', 'victim', 4);
    expect(beginLoginAttempt('10.0.0.1', 'attacker', 0)).toBe(0);
    loginSucceeded('10.0.0.1', 'attacker', 0);
    expect(beginLoginAttempt('10.0.0.1', 'victim', 0)).toBe(0);
    expect(beginLoginAttempt('10.0.0.1', 'victim', 0)).toBeGreaterThan(0);
    expect(beginLoginAttempt('10.0.0.1', 'someone-else', 0)).toBeGreaterThan(0);
    // The attacker's own login is still fine, and still doesn't reset anything.
    expect(beginLoginAttempt('10.0.0.1', 'attacker', 0)).toBeGreaterThan(0);
  });

  it('needs four addresses to lock a user out of addresses they never used', () => {
    for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      fail(ip, 'victim', 5);
      expect(beginLoginAttempt(ip, 'victim', 0)).toBeGreaterThan(0);
    }
    expect(beginLoginAttempt('10.9.9.9', 'victim', 0)).toBe(0); // 16th failure
    loginSucceeded('10.9.9.9', 'victim', 0);
    fail('10.0.0.4', 'victim', 5);
    for (let i = 5; i < 20; i++) fail(`10.0.1.${i}`, 'victim', 1);
    expect(beginLoginAttempt('10.0.2.1', 'victim', 0)).toBeGreaterThan(0);
    // ...and never out of one they signed in from.
    expect(beginLoginAttempt('10.9.9.9', 'victim', 0)).toBe(0);
  });

  it('keeps a bucket near its limit when made-up names flood the table', () => {
    for (let i = 0; i < 19; i++) fail(`10.0.0.${i}`, 'victim', 1);
    for (let i = 0; i < 60000; i++) beginLoginAttempt(GATEWAY, `junk${i}`, 0);
    expect(beginLoginAttempt('10.0.1.1', 'victim', 0)).toBe(0);
    expect(beginLoginAttempt('10.0.1.2', 'victim', 0)).toBeGreaterThan(0);
  });

  it('says how long to wait', () => {
    expect(tooManyAttemptsMessage(15 * 60)).toBe(
      'Too many failed login attempts. Try again in 15 minutes.',
    );
    expect(tooManyAttemptsMessage(10)).toContain('in 1 minute.');
  });
});

describe('shared addresses (r3-auth-3)', () => {
  it('recognises the Docker gateway and loopback', () => {
    for (const ip of [GATEWAY, '::ffff:172.18.0.1', '127.0.0.1', '127.0.0.53', '::1', 'unknown'])
      expect(isSharedAddress(ip)).toBe(true);
    for (const ip of ['172.18.0.2', '192.168.11.13', 'fd00::1', '::ffff:10.0.0.1'])
      expect(isSharedAddress(ip)).toBe(false);
  });

  it('does not let one client behind the gateway lock out the others', () => {
    fail(GATEWAY, 'nobody', 5);
    expect(beginLoginAttempt(GATEWAY, 'nobody', 0)).toBe(15 * 60);
    expect(beginLoginAttempt(GATEWAY, 'u3', 0)).toBe(0);
    expect(beginLoginAttempt('127.0.0.1', 'nobody', 0)).toBe(0);
  });

  it('still limits guesses at one user through the gateway', () => {
    fail(GATEWAY, 'admin', 5);
    expect(beginLoginAttempt(GATEWAY, 'admin', 0)).toBeGreaterThan(0);
    // Only 5 of the 20 per-username failures: admin can still sign in elsewhere.
    expect(beginLoginAttempt('10.0.0.1', 'admin', 0)).toBe(0);
  });

  it('never counts the gateway as an address the user signed in from', () => {
    expect(beginLoginAttempt(GATEWAY, 'admin', 0)).toBe(0);
    loginSucceeded(GATEWAY, 'admin', 0);
    for (let i = 0; i < 20; i++) fail(`10.0.${i}.1`, 'admin', 1);
    expect(beginLoginAttempt(GATEWAY, 'admin', 0)).toBeGreaterThan(0);
  });

  it('reads the default gateway from /proc/net/route', () => {
    const table =
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n' +
      'eth0\t00000000\t010015AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\n' +
      'eth0\t000015AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n';
    expect(parseDefaultGateways(table)).toEqual(['172.21.0.1']);
    expect(parseDefaultGateways('')).toEqual([]);
  });

  it('takes the address from X-Real-IP only', () => {
    const request = (headers: Record<string, string>) => new Request('http://admin.mirror.intra/login', { headers });
    expect(clientIp(request({ 'X-Real-IP': ' 192.168.11.13 ', 'X-Forwarded-For': '6.6.6.6' }))).toBe('192.168.11.13');
    expect(clientIp(request({ 'X-Forwarded-For': '6.6.6.6' }))).toBe('unknown');
  });
});
