import fs from "fs/promises";
import appConfig from "~/config/config.json";

export interface RepositoryConfig {
  title: string;
  content: string[];
}

// Function to parse repository configurations from mirror.list
async function parseRepositoryConfigs(): Promise<RepositoryConfig[]> {
  try {
    const mirrorListPath = appConfig.mirrorListPath;
    const content = await fs.readFile(mirrorListPath, 'utf-8');
    const lines = content.split('\n');
    
    const configs: RepositoryConfig[] = [];
    let currentConfig: RepositoryConfig | null = null;
    let inUsageSection = false;
    
    for (const line of lines) {
      // Check for start section
      const startMatch = line.match(/# ---start---(.+?)---/);
      if (startMatch) {
        currentConfig = {
          title: startMatch[1].trim(),
          content: []
        };
        continue;
      }
      
      // Check for usage start
      if (line.trim() === '# Usage start') {
        inUsageSection = true;
        continue;
      }
      
      // Check for usage end
      if (line.trim() === '# Usage end') {
        inUsageSection = false;
        continue;
      }
      
      // Check for end section
      const endMatch = line.match(/# ---end---(.+?)---/);
      if (endMatch && currentConfig) {
        configs.push(currentConfig);
        currentConfig = null;
        continue;
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
    
    return configs;
  } catch (error) {
    console.error('Error parsing mirror.list:', error);
    return [];
  }
}

export async function loader() {
  const repositoryConfigs = await parseRepositoryConfigs();
  return { repositoryConfigs };
} 