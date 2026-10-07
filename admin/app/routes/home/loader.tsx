import fs from 'fs/promises';
import path from 'path';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { hostAddress, withMirrorHost } from '~/utils/hosts';
import { listKeys, type GpgKeyRecord } from '~/lib/gpg';
import { MirrorConfig, canonicalBaseUrl, type RepositoryInput } from '~/utils/mirror-config';
import { readTail } from '~/utils/read-tail';
import { SYNC_LOG } from '~/utils/log-files';

export interface RepositoryHost {
  host: string;
  gpgKey: GpgKeyRecord | null;
}

export interface RepositoryConfig {
  title: string;
  /** Changes whenever the section's text changes; actions reject a stale one. */
  revision: string;
  content: string[];
  hosts: RepositoryHost[];
  /** Editable definition for pre-filling the edit form (null if unreconstructable). */
  editable: RepositoryInput | null;
}

/** An enabled repository's upstream, for the form's warning about shared package filters. */
interface RepositoryUpstream {
  url: string;
  title: string;
  filtered: boolean;
}

export interface CommentedSection {
  title: string;
  revision: string;
}

// apt-mirror2 filters only downloads; the published indexes still list every upstream package.
const FILTERED_NOTE = [
  '# Filtered mirror: only the selected packages are downloaded, but the index lists all',
  '# upstream packages. Others (including Recommends) return 404; use --no-install-recommends.',
];

const quoteTitles = (titles: string[]) => titles.map((t) => `"${t}"`).join(', ');

/**
 * The filtered-mirror note for a card. apt-mirror2 keeps one filter per upstream (base URL),
 * so the filters of other enabled repositories on the same upstream restrict this one too.
 */
export function filterNote(
  filtered: boolean,
  neighbours: { title: string; filtered: boolean }[],
): string[] {
  const filteredBy = neighbours.filter((n) => n.filtered).map((n) => n.title);
  if (!filtered && !filteredBy.length) return [];
  const lines = [...FILTERED_NOTE];
  if (!filtered) {
    lines.push(
      `# This repository has no filter of its own, but the filter of ${quoteTitles(filteredBy)} (same`,
      '# upstream) applies to it: apt-mirror2 filters per base URL. Add the same filter here, or',
      '# disable one of them.',
    );
    return lines;
  }
  const restricted = neighbours.filter((n) => !n.filtered).map((n) => n.title);
  if (filteredBy.length) {
    lines.push(`# The filters of ${quoteTitles(filteredBy)} (same upstream) are combined with this one.`);
  }
  if (restricted.length) {
    lines.push(`# This filter also restricts ${quoteTitles(restricted)} (same upstream, no filter of its own).`);
  }
  return lines;
}

function rewriteSignedByHint(
  content: string[],
  signedHosts: RepositoryHost[],
): string[] {
  if (signedHosts.length === 0) return content;

  const keyringPath = (host: string) => `/etc/apt/keyrings/${host}.asc`;
  const installLines = signedHosts.map(
    (h) =>
      `# Install pubkey: curl -fsSL http://${hostAddress('mirror')}/api/pubkey/${h.host} | sudo tee ${keyringPath(h.host)} > /dev/null`,
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
      // The mirror folder of an upstream with a port is `host:port`; the key belongs to the host.
      const firstSegment = parsed.pathname.split('/').filter(Boolean)[0]?.replace(/:\d+$/, '');
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
  upstreams: RepositoryUpstream[];
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
    const upstreams: RepositoryUpstream[] = [];

    for (const section of config.sections()) {
      // A section with no active deb directive is shown as a disabled entry the
      // user can re-enable.
      if (!config.isSectionEnabled(section)) {
        commentedSections.push({
          title: section.title,
          revision: config.sectionRevision(section),
        });
        continue;
      }

      for (const url of new Set(
        section.children.flatMap((c) => (c.kind === 'deb' && c.enabled ? [canonicalBaseUrl(c.uri)] : [])),
      )) {
        upstreams.push({ url, title: section.title, filtered: config.isSectionFiltered(section) });
      }

      const hosts: RepositoryHost[] = config
        .sectionHosts(section)
        .map((host) => ({ host, gpgKey: keysIndex[host] ?? null }));
      const signed = hosts.filter((h) => h.gpgKey);

      const usage = rewriteSignedByHint(
        withMirrorHost(config.sectionUsageLines(section), hostAddress('mirror')),
        signed,
      );
      activeConfigs.push({
        title: section.title,
        revision: config.sectionRevision(section),
        hosts,
        content: [
          ...usage,
          ...filterNote(config.isSectionFiltered(section), config.upstreamNeighbours(section)),
        ],
        editable: config.sectionToInput(section),
      });
    }

    return { active: activeConfigs, commented: commentedSections, upstreams };
  } catch (error) {
    console.error('Error parsing mirror.list:', error);
    return { active: [], commented: [], upstreams: [] };
  }
}

/** Tail of the sync log, for the dashboard panel. */
async function readLatestLog(): Promise<{
  name: string;
  content: string;
  firstLine: number;
} | null> {
  try {
    const tail = await readTail(path.join(appConfig.mirrorLogsDir, SYNC_LOG), 64 * 1024);
    const lines = tail.content.split('\n');
    const shown = lines.slice(-400);
    return {
      name: SYNC_LOG,
      content: shown.join('\n'),
      firstLine: tail.firstLine + lines.length - shown.length,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error reading the sync log:', error);
    }
    return null;
  }
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  const [{ active, commented, upstreams }, isLockFilePresent, latestLog] =
    await Promise.all([
      parseRepositoryConfigs(),
      checkLockFile(),
      readLatestLog(),
    ]);
  return {
    repositoryConfigs: active,
    commentedSections: commented,
    upstreams,
    isLockFilePresent,
    latestLog,
  };
}
