import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import os from 'os';

/** Fetches of user-supplied upstream URLs: http(s) only, never this container, bounded in time and size. */

const blocked = new net.BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('224.0.0.0', 3, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');

function ownAddresses(): Set<string> {
  return new Set(
    Object.values(os.networkInterfaces())
      .flat()
      .map((i) => i?.address)
      .filter((a): a is string => !!a),
  );
}

/** Loopback, link-local (cloud metadata), multicast, unspecified, or one of this container's own addresses. */
export function isBlockedAddress(ip: string, own: Set<string> = ownAddresses()): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  const addr = mapped ? mapped[1] : ip;
  const family = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
  if (!family) return true;
  return blocked.check(addr, family) || own.has(addr);
}

export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  /** Override the address check (tests). */
  allowAddress?: (ip: string) => boolean;
}

export class UpstreamFetchError extends Error {}

/** Checks the scheme and, for an IP literal, the address. Returns the parsed URL. */
export function checkUpstreamUrl(raw: string, allow: (ip: string) => boolean = (ip) => !isBlockedAddress(ip)): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamFetchError('Base URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UpstreamFetchError('Base URL must use http or https');
  }
  if (url.username || url.password) {
    throw new UpstreamFetchError('Base URL cannot contain credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !allow(host)) {
    throw new UpstreamFetchError(`Refusing to fetch from ${url.hostname}`);
  }
  return url;
}

/**
 * GET a URL. Returns the body, or null for a non-2xx answer. Every resolved address is checked when
 * connecting (so DNS answers and redirects cannot reach a refused address).
 */
export async function fetchUpstream(raw: string, limits: FetchLimits): Promise<Buffer | null> {
  const allow = limits.allowAddress ?? ((ip: string) => !isBlockedAddress(ip));
  const lookup: net.LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as dns.LookupAddress[];
      const bad = list.find((a) => !allow(a.address));
      if (bad) return callback(new UpstreamFetchError(`Refusing to fetch from ${hostname} (${bad.address})`), '', 0);
      if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };

  let current = raw;
  for (let hop = 0; hop <= (limits.maxRedirects ?? 3); hop++) {
    const url = checkUpstreamUrl(current, allow);
    const result = await new Promise<{ body: Buffer | null; location?: string }>((resolve, reject) => {
      const get = url.protocol === 'https:' ? https.get : http.get;
      const req = get(url, { lookup, timeout: limits.timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ body: null, location: new URL(res.headers.location, url).toString() });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ body: null });
        }
        if (Number(res.headers['content-length'] ?? 0) > limits.maxBytes) {
          req.destroy(new UpstreamFetchError(`${url} is larger than ${limits.maxBytes} bytes`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > limits.maxBytes) {
            req.destroy(new UpstreamFetchError(`${url} is larger than ${limits.maxBytes} bytes`));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      const deadline = setTimeout(
        () => req.destroy(new UpstreamFetchError(`${url} timed out`)),
        limits.timeoutMs,
      );
      req.on('timeout', () => req.destroy(new UpstreamFetchError(`${url} timed out`)));
      req.on('error', reject);
      req.on('close', () => clearTimeout(deadline));
    });
    if (result.location === undefined) return result.body;
    current = result.location;
  }
  throw new UpstreamFetchError(`Too many redirects from ${raw}`);
}
