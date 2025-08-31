import fs from "fs/promises";
import appConfig from "~/config/config.json";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "startSync") {
    try {
      const child = spawn(appConfig.startMirrorScriptPath, [], {
        stdio: 'pipe',
        detached: true
      });
      
      child.unref();
      
      console.log('Start sync initiated with PID:', child.pid);
      
      return { success: true, message: "Mirror sync started successfully" };
    } catch (error) {
      console.error('Error starting mirror sync:', error);
      return { error: "Failed to start mirror sync" };
    }
  }

  if (action === "stopSync") {
    try {
      await execAsync(appConfig.stopMirrorScriptPath);
      return { success: true, message: "Mirror sync stopped successfully" };
    } catch (error) {
      console.error('Error stopping mirror sync:', error);
      return { error: "Failed to stop mirror sync" };
    }
  }

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
        
        if (line.trim() === '# Usage start' && inTargetSection) {
          inUsageSection = true;
          newLines.push(line); // Keep the usage start marker
          continue;
        }
        
        if (line.trim() === '# Usage end' && inTargetSection) {
          inUsageSection = false;
          newLines.push(line); // Keep the usage end marker
          continue;
        }
        
        const endMatch = line.match(/# ---end---(.+?)---/);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line); // Keep the end marker
          continue;
        }
        
        if (inTargetSection && !inUsageSection && line.trim() && !line.startsWith('#')) {
          newLines.push(`# ${line}`);
        } else {
          newLines.push(line);
        }
      }
      
      await fs.writeFile(mirrorListPath, newLines.join('\n'));
      
      return { success: true, message: `Repository section "${sectionTitle}" commented successfully` };
      
    } catch (error) {
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
        
        const startMatch = line.match(/# ---start---(.+?)---/);
        if (startMatch) {
          const title = startMatch[1].trim();
          if (title === sectionTitle) {
            inTargetSection = true;
            newLines.push(line);
            continue;
          } else {
            inTargetSection = false;
            inUsageSection = false;
          }
        }
        
        if (line.trim() === '# Usage start' && inTargetSection) {
          inUsageSection = true;
          newLines.push(line);
          continue;
        }
        
        if (line.trim() === '# Usage end' && inTargetSection) {
          inUsageSection = false;
          newLines.push(line);
          continue;
        }
        
        const endMatch = line.match(/# ---end---(.+?)---/);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line);
          continue;
        }
        
        if (inTargetSection && !inUsageSection && line.trim().startsWith('# ')) {
          newLines.push(line.substring(2));
        } else {
          newLines.push(line);
        }
      }
      
      await fs.writeFile(mirrorListPath, newLines.join('\n'));
      
      return { success: true, message: `Repository section "${sectionTitle}" restored successfully` };
    } catch (error) {
      return { error: "Failed to restore repository section" };
    }
  }

  return { error: "Invalid action" };
} 