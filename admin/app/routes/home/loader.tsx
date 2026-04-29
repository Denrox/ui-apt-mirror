import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { listKeys, type GpgKeyRecord } from '~/lib/gpg';

export interface RepositoryHost {
  host: string;
  gpgKey: GpgKeyRecord | null;
}

export interface RepositoryConfig {
  title: string;
  content: string[];
  hosts: RepositoryHost[];
}

export interface CommentedSection {
  title: string;
}

function extractHosts(activeDebLines: string[]): string[] {
  const hosts = new Set<string>();
  for (const line of activeDebLines) {
    const match = /^\s*deb(?:-src)?\s+(?:\[[^\]]*\]\s+)?(\S+)/.exec(line);
    if (!match) continue;
    try {
      const url = new URL(match[1]);
      if (url.hostname) hosts.add(url.hostname);
    } catch {
      // ignore non-URL deb sources
    }
  }
  return Array.from(hosts);
}

function rewriteSignedByHint(
  content: string[],
  signedHosts: RepositoryHost[],
): string[] {
  if (signedHosts.length === 0) return content;

  const keyringPaths = signedHosts
    .map((h) => `/etc/apt/keyrings/${h.host}.asc`)
    .join(' ');
  const installLines = signedHosts.map(
    (h) =>
      `# Install pubkey: curl -fsSL http://admin.mirror.intra/api/pubkey/${h.host} | sudo tee /etc/apt/keyrings/${h.host}.asc > /dev/null`,
  );

  const filtered = content.filter((line) => !/^\s*Signed-By:/i.test(line));
  return [...installLines, ...filtered, `Signed-By: ${keyringPaths}`];
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
    const lines = content.split('\n');

    const activeConfigs: RepositoryConfig[] = [];
    const commentedSections: CommentedSection[] = [];
    let currentConfig: RepositoryConfig | null = null;
    let inUsageSection = false;
    let sectionLines: string[] = [];
    let sectionStartIndex = -1;
    let currentSectionTitle = '';
    let inTargetSection = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const startMatch = /# ---start---(.+?)---/.exec(line);
      if (startMatch) {
        currentConfig = {
          title: startMatch[1].trim(),
          content: [],
          hosts: [],
        };
        currentSectionTitle = startMatch[1].trim();
        sectionLines = [];
        sectionStartIndex = i;
        inTargetSection = true;
        inUsageSection = false;
        continue;
      }

      if (line.trim() === '# Usage start' && inTargetSection) {
        inUsageSection = true;
        continue;
      }

      if (line.trim() === '# Usage end' && inTargetSection) {
        inUsageSection = false;
        continue;
      }

      const endMatch = /# ---end---(.+?)---/.exec(line);
      if (endMatch && currentConfig && inTargetSection) {
        const activeDebLines = sectionLines.filter(
          (sectionLine) =>
            sectionLine.trim() && !sectionLine.trim().startsWith('#'),
        );

        if (activeDebLines.length > 0) {
          const hosts = extractHosts(activeDebLines);
          currentConfig.hosts = hosts.map((host) => ({
            host,
            gpgKey: keysIndex[host] ?? null,
          }));
          const signed = currentConfig.hosts.filter((h) => h.gpgKey);
          currentConfig.content = rewriteSignedByHint(
            currentConfig.content,
            signed,
          );
          activeConfigs.push(currentConfig);
        } else {
          commentedSections.push({ title: currentSectionTitle });
        }

        currentConfig = null;
        sectionLines = [];
        sectionStartIndex = -1;
        currentSectionTitle = '';
        inTargetSection = false;
        inUsageSection = false;
        continue;
      }

      if (
        currentConfig &&
        sectionStartIndex !== -1 &&
        i > sectionStartIndex &&
        !inUsageSection
      ) {
        sectionLines.push(line);
      }

      if (inUsageSection && currentConfig && line.trim()) {
        const cleanLine = line.trim().replace(/^#\s*/, '');
        if (cleanLine) {
          currentConfig.content.push(cleanLine);
        }
      }
    }

    return { active: activeConfigs, commented: commentedSections };
  } catch (error) {
    console.error('Error parsing mirror.list:', error);
    return { active: [], commented: [] };
  }
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  const [{ active, commented }, isLockFilePresent] = await Promise.all([
    parseRepositoryConfigs(),
    checkLockFile(),
  ]);
  return {
    repositoryConfigs: active,
    commentedSections: commented,
    isLockFilePresent,
  };
}
