import fs from "fs/promises";
import appConfig from "~/config/config.json";

export interface RepositoryConfig {
  title: string;
  content: string[];
}

export interface CommentedSection {
  title: string;
}

// Function to parse repository configurations from mirror.list
async function parseRepositoryConfigs(): Promise<{ active: RepositoryConfig[], commented: CommentedSection[] }> {
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
    let currentSectionTitle = "";
    let inTargetSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for start section
      const startMatch = line.match(/# ---start---(.+?)---/);
      if (startMatch) {
        // Reset for new section
        currentConfig = {
          title: startMatch[1].trim(),
          content: []
        };
        currentSectionTitle = startMatch[1].trim();
        sectionLines = [];
        sectionStartIndex = i;
        inTargetSection = true;
        inUsageSection = false;
        continue;
      }
      
      // Check for usage start
      if (line.trim() === '# Usage start' && inTargetSection) {
        inUsageSection = true;
        continue;
      }
      
      // Check for usage end
      if (line.trim() === '# Usage end' && inTargetSection) {
        inUsageSection = false;
        continue;
      }
      
      // Check for end section
      const endMatch = line.match(/# ---end---(.+?)---/);
      if (endMatch && currentConfig && inTargetSection) {
        // Check if all lines between start and usage start are commented out
        const hasNonCommentedLines = sectionLines.some(sectionLine => 
          sectionLine.trim() && !sectionLine.trim().startsWith('#')
        );
        
        // Add to appropriate list based on whether section is commented
        if (hasNonCommentedLines) {
          activeConfigs.push(currentConfig);
        } else {
          commentedSections.push({ title: currentSectionTitle });
        }
        
        currentConfig = null;
        sectionLines = [];
        sectionStartIndex = -1;
        currentSectionTitle = "";
        inTargetSection = false;
        inUsageSection = false;
        continue;
      }
      
      // Collect section lines between start and usage start for checking if all are commented
      if (currentConfig && sectionStartIndex !== -1 && i > sectionStartIndex && !inUsageSection) {
        sectionLines.push(line);
      }
      
      // Add usage content
      if (inUsageSection && currentConfig && line.trim()) {
        // Remove comment symbol (#) from the beginning of the line
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
  const { active, commented } = await parseRepositoryConfigs();
  return { repositoryConfigs: active, commentedSections: commented };
} 