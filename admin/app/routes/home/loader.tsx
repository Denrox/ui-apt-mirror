import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { listKeys, type GpgKeyRecord } from '~/lib/gpg';
import { MirrorConfig, type RepositoryInput } from '~/utils/mirror-config';

export interface RepositoryHost {
  host: string;
  gpgKey: GpgKeyRecord | null;
}

export interface RepositoryConfig {
  title: string;
  content: string[];
  hosts: RepositoryHost[];
  /** Editable definition for pre-filling the edit form (null if unreconstructable). */
  editable: RepositoryInput | null;
}

export interface CommentedSection {
  title: string;
}

function rewriteSignedByHint(
  content: string[],
  signedHosts: RepositoryHost[],
): string[] {
  if (signedHosts.length === 0) return content;

  const keyringPath = (host: string) => `/etc/apt/keyrings/${host}.asc`;
  const installLines = signedHosts.map(
    (h) =>
      `# Install pubkey: curl -fsSL http://admin.mirror.intra/api/pubkey/${h.host} | sudo tee ${keyringPath(h.host)} > /dev/null`,
  );

  const filtered = content.filter((line) => !/^\s*Signed-By:/i.test(line));
  const isDeb822 = filtered.some((line) => /^\s*Types:\s*deb/i.test(line));

  if (isDeb822) {
    const keyringPaths = signedHosts.map((h) => keyringPath(h.host)).join(' ');
    // Once we emit Signed-By, drop any `Trusted: yes` — the key supersedes it.
    const stripped = filtered.filter(
      (line) => !/^\s*Trusted:\s*yes\b/i.test(line),
    );
    return [...installLines, ...stripped, `Signed-By: ${keyringPaths}`];
  }

  // Legacy one-line `deb [opts] URL ...` format: Signed-By: is not a valid
  // standalone field, so inline [signed-by=PATH] into each deb line. Match
  // the upstream host via the first path segment (the mirror URL embeds it,
  // e.g. http://mirror.intra/deb.debian.org/debian) or via the URL hostname.
  const rewritten = filtered.map((line) => {
    const match = /^(\s*deb(?:-src)?\s+)(?:\[([^\]]*)\]\s+)?(\S+)(\s.*)?$/.exec(
      line,
    );
    if (!match) return line;
    const [, prefix, existingOpts, url, rest = ''] = match;
    const opts = (existingOpts ?? '').trim();
    if (/\bsigned-by=/i.test(opts)) return line;

    let upstreamHost: string | null = null;
    try {
      const parsed = new URL(url);
      const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
      if (firstSegment && signedHosts.some((h) => h.host === firstSegment)) {
        upstreamHost = firstSegment;
      } else if (signedHosts.some((h) => h.host === parsed.hostname)) {
        upstreamHost = parsed.hostname;
      }
    } catch {
      // ignore non-URL deb sources
    }
    if (!upstreamHost) return line;

    // Strip trusted=yes when we have a real key — the signature supersedes it.
    const remainingOpts = opts
      .split(/\s+/)
      .filter((opt) => opt && !/^trusted=yes$/i.test(opt))
      .join(' ');
    const newOpt = `signed-by=${keyringPath(upstreamHost)}`;
    const mergedOpts = remainingOpts ? `${remainingOpts} ${newOpt}` : newOpt;
    return `${prefix}[${mergedOpts}] ${url}${rest}`;
  });

  return [...installLines, ...rewritten];
}

async function parseRepositoryConfigs(): Promise<{
  active: RepositoryConfig[];
  commented: CommentedSection[];
}> {
  try {
    const mirrorListPath = appConfig.mirrorListPath;
    const [content, keysIndex] = await Promise.all([
      fs.readFile(mirrorListPath, 'utf-8'),
      listKeys().catch(() => ({}) as Record<string, GpgKeyRecord>),
    ]);

    const config = MirrorConfig.parse(content);
    const activeConfigs: RepositoryConfig[] = [];
    const commentedSections: CommentedSection[] = [];

    for (const section of config.sections()) {
      // A section with no active deb directive is shown as a disabled entry the
      // user can re-enable.
      if (!config.isSectionEnabled(section)) {
        commentedSections.push({ title: section.title });
        continue;
      }

      const hosts: RepositoryHost[] = config
        .sectionHosts(section)
        .map((host) => ({ host, gpgKey: keysIndex[host] ?? null }));
      const signed = hosts.filter((h) => h.gpgKey);

      activeConfigs.push({
        title: section.title,
        hosts,
        content: rewriteSignedByHint(config.sectionUsageLines(section), signed),
        editable: config.sectionToInput(section),
      });
    }

    return { active: activeConfigs, commented: commentedSections };
  } catch (error) {
    console.error('Error parsing mirror.list:', error);
    return { active: [], commented: [] };
  }
}

/** Tail of the most-recently-modified mirror log, for the dashboard panel. */
async function readLatestLog(): Promise<{
  name: string;
  content: string;
} | null> {
  try {
    const logsDir = appConfig.mirrorLogsDir;
    const entries = await fs.readdir(logsDir);
    const logFiles = entries.filter(
      (f) => f.endsWith('.log') || /\.log.+$/.exec(f),
    );
    if (logFiles.length === 0) return null;

    const withMtime = await Promise.all(
      logFiles.map(async (name) => {
        try {
          const stat = await fs.stat(`${logsDir}/${name}`);
          return { name, mtimeMs: stat.mtimeMs };
        } catch {
          return { name, mtimeMs: 0 };
        }
      }),
    );
    withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = withMtime[0];

    const raw = await fs.readFile(`${logsDir}/${latest.name}`, 'utf-8');
    // Only the tail matters on the dashboard; cap to keep the payload small.
    const content = raw.split('\n').slice(-400).join('\n');
    return { name: latest.name, content };
  } catch (error) {
    console.error('Error reading latest log:', error);
    return null;
  }
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  const [{ active, commented }, isLockFilePresent, latestLog] =
    await Promise.all([
      parseRepositoryConfigs(),
      checkLockFile(),
      readLatestLog(),
    ]);
  return {
    repositoryConfigs: active,
    commentedSections: commented,
    isLockFilePresent,
    latestLog,
  };
}
