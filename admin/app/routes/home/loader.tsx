import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { checkLockFile } from '~/utils/sync';

export interface RepositoryConfig {
  title: string;
  content: string[];
}

export interface CommentedSection {
  title: string;
}

async function parseRepositoryConfigs(): Promise<{
  active: RepositoryConfig[];
  commented: CommentedSection[];
}> {
  try {
    const mirrorListPath = appConfig.mirrorListPath;
    const content = await fs.readFile(mirrorListPath, 'utf-8');
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
        const hasNonCommentedLines = sectionLines.some(
          (sectionLine) =>
            sectionLine.trim() && !sectionLine.trim().startsWith('#'),
        );

        if (hasNonCommentedLines) {
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

export async function loader() {
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
