import { describe, it, expect, beforeEach } from 'vitest';
import { clientIp, isSharedAddress, parseDefaultGateways, resetSharedGateways } from './client-address';

const GATEWAY = '172.18.0.1';

beforeEach(() => resetSharedGateways([GATEWAY]));

describe('client addresses', () => {
  it('recognises the Docker gateway and loopback', () => {
    for (const ip of [GATEWAY, '::ffff:172.18.0.1', '127.0.0.1', '127.0.0.53', '::1', 'unknown'])
      expect(isSharedAddress(ip)).toBe(true);
    for (const ip of ['172.18.0.2', '192.168.11.13', 'fd00::1', '::ffff:10.0.0.1'])
      expect(isSharedAddress(ip)).toBe(false);
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
