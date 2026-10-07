import { readFileSync } from 'fs';

/**
 * The client address as nginx saw it. Every nginx location that proxies to the
 * app sets X-Real-IP to $remote_addr, replacing whatever the client sent, and
 * the app listens on loopback only. X-Forwarded-For is never used: nginx
 * appends to the client's own value.
 */
export function clientIp(request: Request): string {
  return request.headers.get('X-Real-IP')?.trim() || 'unknown';
}

/** IPv4 default gateways in /proc/net/route format (little-endian hex). */
export function parseDefaultGateways(routeTable: string): string[] {
  const gateways: string[] = [];
  for (const line of routeTable.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(gateway ?? '')) continue;
    const bytes = gateway.match(/../g)!.map((b) => parseInt(b, 16)).reverse();
    if (bytes.some((b) => b !== 0)) gateways.push(bytes.join('.'));
  }
  return gateways;
}

let gateways: Set<string> | null = null;

function dockerGateways(): Set<string> {
  if (!gateways) {
    try {
      gateways = new Set(parseDefaultGateways(readFileSync('/proc/net/route', 'utf-8')));
    } catch {
      gateways = new Set();
    }
  }
  return gateways;
}

/**
 * True for an address many clients may share: the container's gateway (docker-proxy
 * connects from there for IPv6 and host-local clients), loopback, or none at all.
 */
export function isSharedAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return (
    ip === 'unknown' ||
    ip === '::1' ||
    v4.startsWith('127.') ||
    dockerGateways().has(v4)
  );
}

/** Treats these addresses as the gateways (for tests); without any, reads the container's again. */
export function resetSharedGateways(sharedGateways?: string[]): void {
  gateways = sharedGateways ? new Set(sharedGateways) : null;
}
