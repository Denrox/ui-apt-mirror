import fs from "fs/promises";
import appConfig from "~/config/config.json";

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "deleteRepository") {
    const sectionTitle = formData.get("sectionTitle") as string;
    
    if (!sectionTitle) {
      return { error: "Section title is required" };
    }

    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const lines = content.split('\n');
      
      const newLines: string[] = [];
      let inTargetSection = false;
      let inUsageSection = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for start section
        const startMatch = line.match(/# ---start---(.+?)---/);
        if (startMatch) {
          const title = startMatch[1].trim();
          if (title === sectionTitle) {
            inTargetSection = true;
            newLines.push(line); // Keep the start marker
            continue;
          } else {
            inTargetSection = false;
            inUsageSection = false;
          }
        }
        
        // Check for usage start
        if (line.trim() === '# Usage start' && inTargetSection) {
          inUsageSection = true;
          newLines.push(line); // Keep the usage start marker
          continue;
        }
        
        // Check for usage end
        if (line.trim() === '# Usage end' && inTargetSection) {
          inUsageSection = false;
          newLines.push(line); // Keep the usage end marker
          continue;
        }
        
        // Check for end section
        const endMatch = line.match(/# ---end---(.+?)---/);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line); // Keep the end marker
          continue;
        }
        
        // Comment lines between start and usage start if in target section
        if (inTargetSection && !inUsageSection && line.trim() && !line.startsWith('#')) {
          newLines.push(`# ${line}`);
        } else {
          newLines.push(line);
        }
      }
      
      // Write the updated content back to the file
      await fs.writeFile(mirrorListPath, newLines.join('\n'));
      
      return { success: true, message: `Repository section "${sectionTitle}" commented successfully` };
      
    } catch (error) {
      console.error('Error commenting repository section:', error);
      return { error: "Failed to comment repository section" };
    }
  }

  if (action === "restoreRepository") {
    const sectionTitle = formData.get("sectionTitle") as string;
    
    if (!sectionTitle) {
      return { error: "Section title is required" };
    }

    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const lines = content.split('\n');
      
      const newLines: string[] = [];
      let inTargetSection = false;
      let inUsageSection = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for start section
        const startMatch = line.match(/# ---start---(.+?)---/);
        if (startMatch) {
          const title = startMatch[1].trim();
          if (title === sectionTitle) {
            inTargetSection = true;
            newLines.push(line); // Keep the start marker
            continue;
          } else {
            inTargetSection = false;
            inUsageSection = false;
          }
        }
        
        // Check for usage start
        if (line.trim() === '# Usage start' && inTargetSection) {
          inUsageSection = true;
          newLines.push(line); // Keep the usage start marker
          continue;
        }
        
        // Check for usage end
        if (line.trim() === '# Usage end' && inTargetSection) {
          inUsageSection = false;
          newLines.push(line); // Keep the usage end marker
          continue;
        }
        
        // Check for end section
        const endMatch = line.match(/# ---end---(.+?)---/);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line); // Keep the end marker
          continue;
        }
        
        // Uncomment lines between start and usage start if in target section
        if (inTargetSection && !inUsageSection && line.trim().startsWith('# ')) {
          newLines.push(line.substring(2)); // Remove the # prefix
        } else {
          newLines.push(line);
        }
      }
      
      // Write the updated content back to the file
      await fs.writeFile(mirrorListPath, newLines.join('\n'));
      
      return { success: true, message: `Repository section "${sectionTitle}" restored successfully` };
      
    } catch (error) {
      console.error('Error restoring repository section:', error);
      return { error: "Failed to restore repository section" };
    }
  }

  return { error: "Invalid action" };
} 