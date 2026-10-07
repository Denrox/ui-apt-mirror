import { describe, it, expect } from 'vitest';
import { assertAdminHost, assertSameOrigin, crossOriginError, isPublicHostRequest } from './request-guard';

const post = (headers: Record<string, string>, url = 'http://admin.mirror.intra/users') =>
  new Request(url, { method: 'POST', headers });

describe('crossOriginError', () => {
  it('lets safe methods through whatever their headers say', () => {
    const get = new Request('http://admin.mirror.intra/users', {
      headers: { Origin: 'http://files.mirror.intra', 'Sec-Fetch-Site': 'same-site' },
    });
    expect(crossOriginError(get)).toBeNull();
  });

  it('accepts same-origin browser posts', () => {
    expect(
      crossOriginError(post({ Origin: 'http://admin.mirror.intra', 'Sec-Fetch-Site': 'same-origin' })),
    ).toBeNull();
    // nginx drops the port from Host; the browser keeps it in Origin.
    expect(crossOriginError(post({ Origin: 'http://ADMIN.mirror.intra:8080' }))).toBeNull();
  });

  it('treats a fully qualified host (trailing dot) as the same host', () => {
    // nginx's $host drops the root dot; the browser keeps it in Origin.
    const fqdn = { Origin: 'http://admin.mirror.intra.', 'Sec-Fetch-Site': 'same-origin' };
    expect(crossOriginError(post(fqdn))).toBeNull();
    expect(crossOriginError(post(fqdn, 'http://admin.mirror.intra./users'))).toBeNull();
    expect(
      crossOriginError(post({ Origin: 'http://admin.mirror.intra' }, 'http://admin.mirror.intra./users')),
    ).toBeNull();
    expect(crossOriginError(post({ Origin: 'http://files.mirror.intra.' }))).toMatch(/Origin/);
    expect(crossOriginError(post({ Origin: 'http://admin.mirror.intra..' }))).toMatch(/Origin/);
  });

  it('accepts clients that send no browser headers', () => {
    expect(crossOriginError(post({}))).toBeNull();
  });

  it('refuses a form posted from the files host (same site, other origin)', () => {
    expect(
      crossOriginError(post({ Origin: 'http://files.mirror.intra', 'Sec-Fetch-Site': 'same-site' })),
    ).toMatch(/same-site/);
    expect(crossOriginError(post({ Origin: 'http://files.mirror.intra' }))).toMatch(/Origin/);
    expect(crossOriginError(post({ 'Sec-Fetch-Site': 'cross-site' }))).toMatch(/cross-site/);
  });

  it('refuses sandboxed or opaque origins', () => {
    expect(crossOriginError(post({ Origin: 'null' }))).toMatch(/Origin: null/);
    expect(crossOriginError(post({ Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }))).not.toBeNull();
  });

  it('checks every unsafe method', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const req = new Request('http://admin.mirror.intra/x', {
        method,
        headers: { Origin: 'http://files.mirror.intra' },
      });
      expect(crossOriginError(req)).not.toBeNull();
    }
  });
});

describe('assertSameOrigin', () => {
  it('throws a 403 response', () => {
    let thrown: unknown;
    try {
      assertSameOrigin(post({ 'Sec-Fetch-Site': 'same-site' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });
});

describe('public hosts', () => {
  it('recognises the files and cheatsheets hosts, whatever the case or domain', () => {
    for (const url of [
      'http://files.mirror.intra/Users',
      'http://CHEATSHEETS.mirror.intra/Login',
      'http://files.example.lan/',
    ]) {
      expect(isPublicHostRequest(new Request(url))).toBe(true);
    }
    for (const url of ['http://admin.mirror.intra/users', 'http://filesystem.lan/', 'http://localhost:5173/']) {
      expect(isPublicHostRequest(new Request(url))).toBe(false);
    }
  });

  it('sends admin-only routes on a public host back to /', () => {
    let thrown: unknown;
    try {
      assertAdminHost(new Request('http://files.mirror.intra/Login', { method: 'POST' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get('Location')).toBe('/');
    expect(() => assertAdminHost(new Request('http://admin.mirror.intra/login'))).not.toThrow();
  });
});
