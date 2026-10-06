import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listLogs, logGroup, pickLog } from './log-files';

let dir: string;

function write(rel: string, mtime: number) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');
  fs.utimesSync(file, mtime, mtime);
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-files-'));
  write('mirror/apt-mirror.log', 1000);
  write('mirror/apt-mirror.log.1', 900);
  write('mirror/apt-mirror.log.2', 800);
  write('mirror/apt-mirror.log.3', 700);
  write('mirror/sign-releases.log', 2000);
  write('mirror/old.log.gz', 3000);
  write('mirror/.gitkeep', 3000);
  write('nginx/admin.access-2026-10-05.log', 500);
  write('nginx/admin.access-2026-10-06.log', 600);
  write('nginx/error.log', 100);
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('logGroup', () => {
  it('groups rotations and daily files', () => {
    expect(logGroup('apt-mirror.log.2')).toBe('apt-mirror');
    expect(logGroup('nginx/admin.access-2026-10-06.log')).toBe(
      'nginx/admin.access',
    );
  });
});

describe('listLogs', () => {
  it('lists each source by log, newest first within a log', async () => {
    const logs = await listLogs([
      { dir: path.join(dir, 'mirror'), prefix: '' },
      { dir: path.join(dir, 'missing'), prefix: 'missing/' },
      { dir: path.join(dir, 'nginx'), prefix: 'nginx/' },
    ]);
    expect(logs.map((l) => l.name)).toEqual([
      'apt-mirror.log',
      'apt-mirror.log.1',
      'apt-mirror.log.2',
      'sign-releases.log',
      'nginx/admin.access-2026-10-06.log',
      'nginx/admin.access-2026-10-05.log',
      'nginx/error.log',
    ]);
    expect(logs[0].path).toBe(path.join(dir, 'mirror', 'apt-mirror.log'));
  });
});

describe('pickLog', () => {
  const log = (name: string, mtimeMs: number) => ({
    name,
    path: name,
    mtimeMs,
    size: 0,
  });
  const logs = [
    log('sign-releases.log', 2),
    log('apt-mirror.log', 1),
    log('nginx/error.log', 3),
  ];

  it('prefers the requested log, then the sync log, then the newest', () => {
    expect(pickLog(logs, 'nginx/error.log')?.name).toBe('nginx/error.log');
    expect(pickLog(logs, '../etc/passwd')?.name).toBe('apt-mirror.log');
    expect(pickLog(logs, null)?.name).toBe('apt-mirror.log');
    expect(pickLog(logs.slice(0, 1).concat(logs[2]), null)?.name).toBe(
      'nginx/error.log',
    );
    expect(pickLog([], null)).toBeUndefined();
  });
});
