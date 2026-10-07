import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));
vi.mock('~/config/config.json', () => ({
  default: {
    get gpgHome() {
      return `${state.dir}/gnupg`;
    },
    get gpgKeysIndex() {
      return `${state.dir}/keys.json`;
    },
  },
}));

const { generateKey, deleteKey } = await import('./gpg');

// A stand-in for gpg: key generation takes a moment, records the key and reports it.
const FAKE_GPG = `#!/bin/sh
case " $* " in
  *" --gen-key "*)
    cat > /dev/null
    sleep 0.1
    fpr=$(od -An -N20 -tx1 /dev/urandom | tr -d ' \\n' | tr a-f A-F)
    echo "$fpr" >> "$GNUPGHOME/created"
    echo "[GNUPG:] KEY_CREATED P $fpr"
    ;;
esac
exit 0
`;

let oldPath: string | undefined;
beforeAll(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uam-gpg-'));
  fs.mkdirSync(`${state.dir}/bin`);
  fs.writeFileSync(`${state.dir}/bin/gpg`, FAKE_GPG, { mode: 0o755 });
  oldPath = process.env.PATH;
  process.env.PATH = `${state.dir}/bin:${oldPath}`;
});
afterAll(() => {
  process.env.PATH = oldPath;
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('signing key housekeeping', () => {
  it('creates one key when several generate requests for a host arrive at once', async () => {
    const results = await Promise.allSettled([1, 2, 3].map(() => generateKey('deb.debian.org')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)))
      .toEqual([expect.stringMatching(/already exists/), expect.stringMatching(/already exists/)]);

    const created = fs.readFileSync(`${state.dir}/gnupg/created`, 'utf-8').trim().split('\n');
    expect(created).toHaveLength(1);
    const index = JSON.parse(fs.readFileSync(`${state.dir}/keys.json`, 'utf-8'));
    expect(index['deb.debian.org'].fingerprint).toBe(created[0]);
  });

  it('reports whether there was a key to delete', async () => {
    expect(await deleteKey('nokey.example.com')).toBe(false);
    expect(await deleteKey('deb.debian.org')).toBe(true);
    expect(await deleteKey('deb.debian.org')).toBe(false);
  });
});
