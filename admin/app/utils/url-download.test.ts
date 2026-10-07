import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { DOWNLOAD_CANCELLED, startDownload } from './url-download';

let server: http.Server;
let base: string;
let dir: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.end('hello');
        break;
      case '/redir':
        res.writeHead(302, { Location: '/ok' });
        res.end();
        break;
      case '/redir-abs':
        res.writeHead(301, { Location: `${base}/redir` });
        res.end();
        break;
      case '/loop':
        res.writeHead(302, { Location: '/loop' });
        res.end();
        break;
      case '/redir-file':
        res.writeHead(302, { Location: 'file:///etc/passwd' });
        res.end();
        break;
      case '/stall':
        res.writeHead(200, { 'Content-Length': '100000' });
        res.write('x'.repeat(1000));
        break;
      case '/reset':
        res.writeHead(200, { 'Content-Length': '100000' });
        res.write('x'.repeat(5000), () => setTimeout(() => req.socket.destroy(), 20));
        break;
      case '/slow':
        res.writeHead(200);
        res.write('x'.repeat(1000));
        break;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-download-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const dest = () => path.join(dir, 'f.bin');
const openFdsInDir = () =>
  fs.readdirSync('/proc/self/fd').filter((fd) => {
    try {
      return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(dir);
    } catch {
      return false;
    }
  });
const leftovers = () => fs.readdirSync(dir);

describe('startDownload', () => {
  it('stores the file under its name', async () => {
    expect(await startDownload(`${base}/ok`, dest()).done).toEqual({ ok: true });
    expect(fs.readFileSync(dest(), 'utf-8')).toBe('hello');
    expect(leftovers()).toEqual(['f.bin']);
  });

  it('follows redirects (r2-files-5)', async () => {
    expect(await startDownload(`${base}/redir`, dest()).done).toEqual({ ok: true });
    expect(fs.readFileSync(dest(), 'utf-8')).toBe('hello');
    fs.rmSync(dest());
    expect(await startDownload(`${base}/redir-abs`, dest()).done).toEqual({ ok: true });
  });

  it('stops after a bounded number of redirects and only follows http(s)', async () => {
    expect(await startDownload(`${base}/loop`, dest()).done).toEqual({ ok: false, error: 'Too many redirects' });
    expect((await startDownload(`${base}/redir-file`, dest()).done).ok).toBe(false);
    expect((await startDownload('file:///etc/passwd', dest()).done).ok).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('reports the status of a failed request', async () => {
    expect(await startDownload(`${base}/missing`, dest()).done).toEqual({
      ok: false,
      error: 'The server answered 404',
    });
    expect(leftovers()).toEqual([]);
  });

  it('a stalled transfer fails and leaves nothing behind (r2-files-4)', async () => {
    const result = await startDownload(`${base}/stall`, dest(), { idleTimeoutMs: 200 }).done;
    expect(result).toEqual({ ok: false, error: 'The server stopped responding' });
    expect(leftovers()).toEqual([]);
    expect(openFdsInDir()).toEqual([]);
  });

  it('a connection reset mid-body settles and leaves nothing behind (r2-files-4)', async () => {
    const result = await startDownload(`${base}/reset`, dest(), { idleTimeoutMs: 5000 }).done;
    expect(result.ok).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(openFdsInDir()).toEqual([]);
  });

  it('cancel stops the transfer, closes the file and frees its space (r2-files-4)', async () => {
    const download = startDownload(`${base}/slow`, dest());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fs.existsSync(dest())).toBe(false); // never visible under its name while running
    download.cancel();
    expect(await download.done).toEqual({ ok: false, error: DOWNLOAD_CANCELLED });
    expect(leftovers()).toEqual([]);
    expect(openFdsInDir()).toEqual([]);
  });

  it('never replaces a file that appeared under the name meanwhile', async () => {
    fs.writeFileSync(dest(), 'theirs');
    const result = await startDownload(`${base}/ok`, dest()).done;
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(dest(), 'utf-8')).toBe('theirs');
    expect(leftovers()).toEqual(['f.bin']);
  });
});
