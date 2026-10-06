import { randomBytes } from 'crypto';

// npm's own rules for package names; anything else could escape the storage dirs.
export const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
export const NPM_VERSION_RE = /^[0-9A-Za-z.+-]{1,256}$/;
const DIST_TAG_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

export const METADATA_TTL_MS = 10 * 60 * 1000;
const LEGACY_REV = '0-legacy';

export interface PackageDoc {
  _id?: string;
  _rev?: string;
  name: string;
  versions: Record<string, any>;
  'dist-tags': Record<string, string>;
  time?: Record<string, string>;
  [key: string]: unknown;
}

export type NpmPath =
  | { kind: 'package'; name: string; rev?: string }
  | { kind: 'tarball'; name: string; file: string; rev?: string }
  | { kind: 'distTags'; name: string; tag?: string }
  | { kind: 'other' };

export type DocResult = { doc: PackageDoc } | { status: number; reason: string };

export function isValidName(name: string): boolean {
  return name.length <= 214 && NPM_NAME_RE.test(name);
}

/** A tag may not look like a version or range, or `npm install pkg@tag` becomes ambiguous. */
export function isValidDistTag(tag: string): boolean {
  return DIST_TAG_RE.test(tag) && !/^v\d/i.test(tag);
}

function splitName(segments: string[]): { name: string; rest: string[] } | null {
  const count = segments[0]?.startsWith('@') ? 2 : 1;
  const name = segments.slice(0, count).join('/');
  return segments.length >= count && isValidName(name) ? { name, rest: segments.slice(count) } : null;
}

/** Classify a registry path (without the /npm prefix); scoped names may arrive as @scope%2fname. */
export function parseNpmPath(raw: string): NpmPath {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.replace(/^\/+/, '').replace(/\/+$/, ''));
  } catch {
    return { kind: 'other' };
  }
  const segments = decoded.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return { kind: 'other' };

  if (segments[0] === '-') {
    if (segments[1] !== 'package') return { kind: 'other' };
    const parsed = splitName(segments.slice(2));
    if (!parsed || parsed.rest[0] !== 'dist-tags' || parsed.rest.length > 2) return { kind: 'other' };
    return { kind: 'distTags', name: parsed.name, tag: parsed.rest[1] };
  }

  const parsed = splitName(segments);
  if (!parsed) return { kind: 'other' };
  const { name, rest } = parsed;
  if (rest.length === 0) return { kind: 'package', name };
  if (rest.length === 2 && rest[0] === '-rev') return { kind: 'package', name, rev: rest[1] };
  if (rest[0] === '-' && rest.length >= 2) {
    const revAt = rest.indexOf('-rev', 1);
    if (revAt === -1) return { kind: 'tarball', name, file: rest.slice(1).join('/') };
    if (revAt > 1 && revAt === rest.length - 2) {
      return { kind: 'tarball', name, file: rest.slice(1, revAt).join('/'), rev: rest[revAt + 1] };
    }
  }
  return { kind: 'other' };
}

export function nextRev(rev?: string): string {
  return `${(parseInt(rev ?? '', 10) || 0) + 1}-${randomBytes(8).toString('hex')}`;
}

export function currentRev(doc: PackageDoc): string {
  return doc._rev ?? LEGACY_REV;
}

export function revMatches(doc: PackageDoc, rev: string | undefined): boolean {
  return rev === undefined || rev === currentRev(doc);
}

/** Add the versions of a publish request to the stored document; existing versions are immutable. */
export function mergePublish(
  existing: PackageDoc | null,
  incoming: any,
  publishedBy: string,
  now = new Date().toISOString(),
): DocResult {
  const name: string = incoming.name;
  const versions: Record<string, any> = incoming.versions ?? {};
  const added = Object.keys(versions);
  if (added.length === 0) return { status: 400, reason: 'No versions to publish' };

  const taken = added.filter((v) => existing?.versions?.[v]);
  if (taken.length) {
    return {
      status: 403,
      reason: `You cannot publish over the previously published versions: ${taken.join(', ')}.`,
    };
  }

  const time = { ...existing?.time };
  for (const version of added) time[version] = now;
  time.created ??= now;
  time.modified = now;

  return {
    doc: {
      ...existing,
      _id: name,
      _rev: nextRev(existing?._rev),
      name,
      versions: { ...existing?.versions, ...versions },
      'dist-tags': { ...existing?.['dist-tags'], ...(incoming['dist-tags'] ?? { latest: added[0] }) },
      _attachments: {},
      time,
      _publishedBy: publishedBy,
    },
  };
}

/**
 * Apply a document PUT without tarballs (npm deprecate, unpublish of one version): versions may be
 * removed or (un)deprecated and dist-tags changed, but nothing else of a version is taken over.
 */
export function applyDocUpdate(
  existing: PackageDoc,
  incoming: any,
  now = new Date().toISOString(),
): DocResult {
  const incomingVersions: Record<string, any> = incoming.versions ?? {};
  const keep = Object.keys(incomingVersions);
  if (keep.some((v) => !existing.versions[v])) {
    return { status: 400, reason: 'New versions must be published with their tarball' };
  }
  if (keep.length === 0) return { status: 400, reason: 'Use npm unpublish to remove the package' };

  const versions: Record<string, any> = {};
  for (const version of keep) {
    const data = { ...existing.versions[version] };
    const deprecated = incomingVersions[version]?.deprecated;
    if (typeof deprecated === 'string' && deprecated) data.deprecated = deprecated;
    else delete data.deprecated;
    versions[version] = data;
  }

  const tags = Object.entries<unknown>(incoming['dist-tags'] ?? existing['dist-tags']).filter(
    ([tag, version]) => typeof version === 'string' && versions[version] && isValidDistTag(tag),
  ) as [string, string][];
  const distTags = Object.fromEntries(tags);
  distTags.latest ??= keep[keep.length - 1];

  const time: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing.time ?? {})) {
    if (versions[key] || !existing.versions[key]) time[key] = value;
  }
  time.modified = now;

  return {
    doc: { ...existing, versions, 'dist-tags': distTags, time, _rev: nextRev(existing._rev) },
  };
}

export function isFresh(cachedAt: string | undefined, now = Date.now(), ttlMs = METADATA_TTL_MS): boolean {
  const at = cachedAt ? Date.parse(cachedAt) : NaN;
  return Number.isFinite(at) && now - at < ttlMs && at <= now;
}

/** The registry is only served on the npm vhost and only when enabled. */
export function isRegistryRequest(host: string | null, enabled = process.env.NPM_PROXY_ENABLED): boolean {
  return enabled === 'true' && !!host && host.toLowerCase().startsWith('npm.');
}

// Tokens are issued by this registry; they and the client's identity never go upstream.
const PRIVATE_HEADERS = new Set(['authorization', 'cookie', 'x-npm-auth-token', 'x-npm-auth-type', 'x-npm-session']);

/** Headers for a request to the upstream registry, copied from the client's (lower-cased) headers. */
export function upstreamHeaders(
  original: Record<string, string>,
  pass: string[],
  base: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'npm-cache-proxy/1.0', ...base };
  for (const name of pass) {
    if (original[name] && !PRIVATE_HEADERS.has(name)) headers[name] = original[name];
  }
  return headers;
}

export function isAuditPath(packagePath: string): boolean {
  return packagePath.startsWith('-/npm/v1/security/');
}

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function auditTree(node: Record<string, any>, names: Set<string>, drop?: Set<string>): Record<string, any> {
  const out = { ...node };
  for (const key of ['requires', 'dependencies']) {
    if (!isObject(node[key])) continue;
    const entries = Object.entries(node[key]).filter(([name]) => (names.add(name), !drop?.has(name)));
    out[key] = Object.fromEntries(
      entries.map(([name, dep]) => [name, key === 'dependencies' && isObject(dep) ? auditTree(dep, names, drop) : dep]),
    );
  }
  return out;
}

/** Package names in an audit payload: bulk is {name: versions}, a quick audit a lockfile-like tree. */
export function auditPackageNames(payload: unknown, bulk: boolean): string[] {
  if (!isObject(payload)) return [];
  if (bulk) return Object.keys(payload);
  const names = new Set<string>();
  if (typeof payload.name === 'string') names.add(payload.name);
  for (const key of ['install', 'remove']) {
    if (Array.isArray(payload[key])) payload[key].forEach((name: unknown) => names.add(String(name)));
  }
  auditTree(payload, names);
  return [...names];
}

/** The audit payload without the given (private) packages, which must not be sent upstream. */
export function withoutAuditPackages(payload: Record<string, any>, bulk: boolean, drop: Set<string>) {
  if (bulk) return Object.fromEntries(Object.entries(payload).filter(([name]) => !drop.has(name)));
  const out = auditTree(payload, new Set(), drop);
  for (const key of ['install', 'remove']) {
    if (Array.isArray(out[key])) out[key] = out[key].filter((name: unknown) => !drop.has(String(name)));
  }
  if (drop.has(out.name)) {
    delete out.name;
    delete out.version;
  }
  return out;
}

/** Where an upstream response is cached, relative to the public dir; null for paths never cached. */
export function publicCachePath(route: NpmPath): string | null {
  if (route.kind === 'package' && route.rev === undefined) return route.name;
  if (route.kind === 'tarball' && route.rev === undefined) {
    const [first, ...rest] = route.name.split('/');
    return [`${first}-tarballs`, ...rest, '-', route.file].join('/');
  }
  return null;
}
