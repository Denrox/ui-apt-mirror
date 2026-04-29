import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import appConfig from '~/config/config.json';

const execAsync = promisify(exec);

export interface GpgKeyRecord {
  fingerprint: string;
  keyId: string;
  uid: string;
  createdAt: string;
}

type KeysIndex = Record<string, GpgKeyRecord>;

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function assertValidHost(host: string): void {
  if (!host || host.length > 253 || !HOST_RE.test(host)) {
    throw new Error(`Invalid host: ${host}`);
  }
}

function gpgEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GNUPGHOME: appConfig.gpgHome };
}

async function ensureGpgHome(): Promise<void> {
  await fs.mkdir(appConfig.gpgHome, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(appConfig.gpgHome, 0o700);
  } catch {}
}

async function readIndex(): Promise<KeysIndex> {
  try {
    const raw = await fs.readFile(appConfig.gpgKeysIndex, 'utf-8');
    return JSON.parse(raw) as KeysIndex;
  } catch (err: any) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeIndex(index: KeysIndex): Promise<void> {
  const dir = path.dirname(appConfig.gpgKeysIndex);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(appConfig.gpgKeysIndex, JSON.stringify(index, null, 2));
}

function runGpg(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('gpg', args, { env: gpgEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`gpg exited ${code}: ${stderr.trim()}`));
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

async function findFingerprintByUid(uid: string): Promise<string | null> {
  const { stdout } = await runGpg(['--list-keys', '--with-colons', uid]).catch(() => ({
    stdout: '',
  }));
  let lastFpr: string | null = null;
  let foundUid = false;
  for (const line of stdout.split('\n')) {
    const cols = line.split(':');
    if (cols[0] === 'fpr' && cols[9]) {
      lastFpr = cols[9];
    }
    if (cols[0] === 'uid' && cols[9] && cols[9].includes(uid)) {
      foundUid = true;
    }
  }
  return foundUid ? lastFpr : null;
}

export async function listKeys(): Promise<KeysIndex> {
  return readIndex();
}

export async function getKey(host: string): Promise<GpgKeyRecord | null> {
  assertValidHost(host);
  const index = await readIndex();
  return index[host] ?? null;
}

export async function generateKey(host: string): Promise<GpgKeyRecord> {
  assertValidHost(host);
  await ensureGpgHome();

  const index = await readIndex();
  if (index[host]) {
    throw new Error(`A signing key already exists for ${host}`);
  }

  const name = `apt-mirror+${host}`;
  const email = `apt-mirror+${host}@mirror.intra`;
  const uid = `${name} <${email}>`;
  const batch = [
    '%no-protection',
    'Key-Type: EDDSA',
    'Key-Curve: ed25519',
    'Key-Usage: sign',
    `Name-Real: ${name}`,
    `Name-Email: ${email}`,
    'Expire-Date: 0',
    '%commit',
    '',
  ].join('\n');

  await runGpg(['--batch', '--pinentry-mode', 'loopback', '--gen-key'], batch);

  const fingerprint = await findFingerprintByUid(email);
  if (!fingerprint) {
    throw new Error('Key generated but fingerprint lookup failed');
  }

  const record: GpgKeyRecord = {
    fingerprint,
    keyId: fingerprint.slice(-16),
    uid,
    createdAt: new Date().toISOString(),
  };

  index[host] = record;
  await writeIndex(index);
  return record;
}

export async function exportPublicKey(host: string): Promise<string> {
  assertValidHost(host);
  const record = await getKey(host);
  if (!record) throw new Error(`No key for ${host}`);
  const { stdout } = await runGpg(['--armor', '--export', record.fingerprint]);
  if (!stdout.trim()) throw new Error(`gpg returned empty key material for ${host}`);
  return stdout;
}

export async function deleteKey(host: string): Promise<void> {
  assertValidHost(host);
  const index = await readIndex();
  const record = index[host];
  if (!record) return;

  await runGpg([
    '--batch',
    '--yes',
    '--delete-secret-and-public-key',
    record.fingerprint,
  ]).catch(() => undefined);

  delete index[host];
  await writeIndex(index);
}

export async function signReleasesForHost(host: string): Promise<void> {
  assertValidHost(host);
  const record = await getKey(host);
  if (!record) throw new Error(`No key for ${host}`);
  await execAsync(`${appConfig.signReleasesScriptPath} ${host}`, {
    env: {
      ...process.env,
      GNUPG_HOME: appConfig.gpgHome,
      GPG_KEYS_INDEX: appConfig.gpgKeysIndex,
      MIRROR_ROOT: appConfig.mirrorRoot,
    },
  });
}
