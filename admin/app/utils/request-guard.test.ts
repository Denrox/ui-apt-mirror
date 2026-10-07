import { describe, it, expect } from 'vitest';
import { assertSameOrigin, crossOriginError } from './request-guard';

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
