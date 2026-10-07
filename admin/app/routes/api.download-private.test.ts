import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const dirs = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-private-')));
  const priv = path.join(base, 'files-private');
  fs.mkdirSync(priv);
  return { base, priv };
});

vi.mock('~/config/config.json', () => ({ default: { privateFilesDir: dirs.priv } }));
vi.mock('~/utils/auth-middleware', () => ({ requireAuthMiddleware: async () => ({}) }));

const { loader } = await import('./api.download-private');

const file = path.join(dirs.priv, 'clip.mp4');
const data = Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 251));
fs.writeFileSync(file, data);

afterAll(() => fs.rmSync(dirs.base, { recursive: true, force: true }));

const get = (headers: Record<string, string> = {}) =>
  loader({
    request: new Request(`http://admin.mirror.intra/api/download-private?path=${encodeURIComponent(file)}`, {
      headers,
    }),
  });

describe('/api/download-private ranges', () => {
  it('sends the whole file and advertises ranges', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data);
  });

  it('answers a single range with 206', async () => {
    const res = await get({ Range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 100-199/3000');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data.subarray(100, 200));
  });

  it('answers a range past the end with 416', async () => {
    const res = await get({ Range: 'bytes=5000-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */3000');
  });

  it('sends the whole file when If-Range names another version', async () => {
    const res = await get({ Range: 'bytes=100-199', 'If-Range': 'Thu, 01 Jan 1970 00:00:00 GMT' });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data);
    const lastModified = (await get()).headers.get('Last-Modified')!;
    expect((await get({ Range: 'bytes=100-199', 'If-Range': lastModified })).status).toBe(206);
  });
});
