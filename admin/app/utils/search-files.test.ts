import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { searchFiles } from './search-files';

let base: string;
let files: string;
let priv: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'search-files-')));
  files = path.join(base, 'files');
  priv = path.join(base, 'files-private');
  fs.mkdirSync(path.join(files, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'outside'));
  fs.mkdirSync(priv);
  fs.writeFileSync(path.join(files, 'docs', 'match-a.txt'), 'a');
  fs.writeFileSync(path.join(base, 'outside', 'match-out.txt'), 'x');
  fs.writeFileSync(path.join(priv, 'match-priv.txt'), 'p');
  fs.symlinkSync(path.join(base, 'outside'), path.join(files, 'link-out'));
  fs.symlinkSync('/etc', path.join(files, 'link-etc'));
  fs.symlinkSync(path.join(files, 'docs'), path.join(files, 'link-docs'));
  fs.symlinkSync(priv, path.join(files, 'link-priv'));
  fs.symlinkSync(path.join(files, 'gone'), path.join(files, 'match-dangling'));
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const names = ({ results }: { results: { path: string }[] }) => results.map((r) => path.relative(files, r.path)).sort();

describe('searchFiles (r2-files-7)', () => {
  it('does not follow symlinks out of the roots', async () => {
    // link-docs leads to a folder already searched, so it is not walked twice.
    expect(names(await searchFiles(files, 'match', [files]))).toEqual(['docs/match-a.txt']);
    expect((await searchFiles(files, 'passwd', [files])).results).toEqual([]);
  });

  it('follows links into another allowed root', async () => {
    expect(names(await searchFiles(files, 'match', [files, priv]))).toContain('link-priv/match-priv.txt');
  });
});

describe('searchFiles limits (r2-files-8)', () => {
  it('returns at most `limit` matches and says so', async () => {
    const many = path.join(files, 'many');
    fs.mkdirSync(many);
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(many, `item-${i}.txt`), '');
    const capped = await searchFiles(many, 'item-', [files], 10);
    expect(capped.results).toHaveLength(10);
    expect(capped.truncated).toBe(true);
    const exact = await searchFiles(many, 'item-', [files], 30);
    expect(exact.results).toHaveLength(30);
    expect(exact.truncated).toBe(false);
  });
});
