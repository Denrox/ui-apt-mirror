import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const dirs = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs');
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-action-')));
  return {
    base,
    files: path.join(base, 'files'),
    priv: path.join(base, 'files-private'),
    mirror: path.join(base, 'apt-mirror'),
    npm: path.join(base, 'npm'),
    outside: path.join(base, 'outside'),
  };
});

vi.mock('~/config/config.json', () => ({
  default: {
    filesDir: dirs.files,
    privateFilesDir: dirs.priv,
    mirroredPackagesDir: dirs.mirror,
    npmPackagesDir: dirs.npm,
    healthReportFile: path.join(dirs.base, 'health.json'),
  },
}));
vi.mock('~/utils/auth-middleware', () => ({ requireAuthMiddleware: async () => ({}) }));
vi.mock('~/utils/sync', () => ({ checkLockFile: async () => false }));

const { action } = await import('./action');

async function post(fields: Record<string, string | Blob>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  const request = new Request('http://admin.mirror.intra/file-manager', { method: 'POST', body });
  return action({ request } as any);
}

beforeEach(() => {
  for (const dir of Object.values(dirs)) {
    if (dir !== dirs.base) fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of [dirs.files, dirs.priv, dirs.mirror, dirs.npm, dirs.outside]) fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dirs.priv, 'victim', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(dirs.priv, 'victim', 'inner', 'data.txt'), 'data');
  fs.writeFileSync(path.join(dirs.priv, 'victim', 't.txt'), 't');
  fs.symlinkSync(path.join(dirs.priv, 'victim'), path.join(dirs.files, 'link-dir'));
  fs.symlinkSync(path.join(dirs.priv, 'victim', 't.txt'), path.join(dirs.files, 'link-file.txt'));
  fs.symlinkSync('/etc', path.join(dirs.files, 'link-etc'));
  fs.symlinkSync(path.join(dirs.files, 'gone'), path.join(dirs.files, 'dangling'));
});

afterAll(() => fs.rmSync(dirs.base, { recursive: true, force: true }));

const victimIntact = () => {
  expect(fs.readFileSync(path.join(dirs.priv, 'victim', 'inner', 'data.txt'), 'utf-8')).toBe('data');
  expect(fs.readFileSync(path.join(dirs.priv, 'victim', 't.txt'), 'utf-8')).toBe('t');
};

describe('symlinks are operated on as links (r2-files-1, r2-files-16)', () => {
  it('deleting a link removes the link and leaves the target alone', async () => {
    for (const name of ['link-file.txt', 'link-dir']) {
      const res = await post({ intent: 'deleteFile', filePath: path.join(dirs.files, name) });
      expect(res.success).toBe(true);
      expect(fs.existsSync(path.join(dirs.files, name))).toBe(false);
    }
    victimIntact();
  });

  it('a link that points outside the roots can still be deleted', async () => {
    for (const name of ['link-etc', 'dangling']) {
      const res = await post({ intent: 'deleteFile', filePath: path.join(dirs.files, name) });
      expect(res.success).toBe(true);
      expect(() => fs.lstatSync(path.join(dirs.files, name))).toThrow();
    }
    expect(fs.existsSync('/etc/passwd')).toBe(true);
  });

  it('renaming a link renames the link', async () => {
    const res = await post({
      intent: 'renameFile',
      filePath: path.join(dirs.files, 'link-file.txt'),
      newName: 'renamed.txt',
    });
    expect(res.success).toBe(true);
    expect(fs.readlinkSync(path.join(dirs.files, 'renamed.txt'))).toBe(path.join(dirs.priv, 'victim', 't.txt'));
    victimIntact();
  });

  it('moving a link moves the link, not the private directory', async () => {
    fs.mkdirSync(path.join(dirs.files, 'dst'));
    const res = await post({
      intent: 'moveFile',
      sourcePath: path.join(dirs.files, 'link-dir'),
      destinationPath: path.join(dirs.files, 'dst'),
    });
    expect(res.success).toBe(true);
    expect(fs.lstatSync(path.join(dirs.files, 'dst', 'link-dir')).isSymbolicLink()).toBe(true);
    victimIntact();
  });

  it('renaming onto a dangling link is refused', async () => {
    fs.writeFileSync(path.join(dirs.files, 'a.txt'), 'a');
    const res = await post({ intent: 'renameFile', filePath: path.join(dirs.files, 'a.txt'), newName: 'dangling' });
    expect(res.success).toBe(false);
    expect(fs.lstatSync(path.join(dirs.files, 'dangling')).isSymbolicLink()).toBe(true);
  });

  it('still refuses roots and paths outside them', async () => {
    for (const filePath of [dirs.files, `${dirs.files}/`, `${dirs.priv}/.`, path.join(dirs.files, 'link-etc', 'passwd'), path.join(dirs.files, '..', 'outside')]) {
      const res = await post({ intent: 'deleteFile', filePath });
      expect(res).toEqual({ success: false, error: 'Path is outside the file storage' });
    }
    expect(fs.existsSync(dirs.files)).toBe(true);
    expect(fs.existsSync(dirs.outside)).toBe(true);
  });
});

describe('uploads', () => {
  it('stores an empty file sent as one empty chunk (r2-files-13)', async () => {
    const res = await post({
      intent: 'uploadChunk',
      filePath: dirs.files,
      chunk: new Blob([]),
      chunkIndex: '0',
      totalChunks: '1',
      fileName: '__init__.py',
      fileId: 'empty1',
    });
    expect(res).toEqual({ success: true, message: 'File uploaded successfully' });
    expect(fs.statSync(path.join(dirs.files, '__init__.py')).size).toBe(0);
  });

  it('refuses a name that is too long with a clear message (r2-files-15)', async () => {
    const res = await post({
      intent: 'uploadChunk',
      filePath: dirs.files,
      chunk: new Blob(['x']),
      chunkIndex: '0',
      totalChunks: '1',
      fileName: '日'.repeat(100),
      fileId: 'long1',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/too long/);
    expect(fs.readdirSync(dirs.files).filter((n) => n.startsWith('.'))).toEqual([]);
  });
});

describe('URL download (r2-files-4)', () => {
  it('cancelling ends the pending request and leaves nothing behind', async () => {
    const http = await import('http');
    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.write('x'.repeat(1000));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as import('net').AddressInfo;
    try {
      const pending = post({
        intent: 'downloadFile',
        url: `http://127.0.0.1:${port}/slow`,
        fileName: 'slow.bin',
        currentPath: dirs.files,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const cancel = await post({ intent: 'cleanupDownload', filePath: dirs.files, fileName: 'slow.bin' });
      expect(cancel.success).toBe(true);
      expect(await pending).toEqual({ success: false, error: 'Failed to download file: Download cancelled' });
      expect(fs.readdirSync(dirs.files).filter((n) => n.includes('slow') || n.startsWith('.tmp-'))).toEqual([]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
