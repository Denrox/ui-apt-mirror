import { exec } from "child_process";
import { promisify } from "util";
import appConfig from "~/config/config.json";

const execAsync = promisify(exec);

export async function loader() {
  try {
    const { stdout } = await execAsync(appConfig.resourceMonitorScriptPath);
    
    const resourceData = JSON.parse(stdout);
    
    return resourceData;
  } catch (error) {
    console.error("Error getting resource data:", error);
    
    return {
      error: "Failed to get resource data",
      timestamp: new Date().toISOString(),
      system: { totalRamMb: 0, cpuPercent: 0 },
      processes: [
        { name: "apt-mirror", status: "error", ramMb: 0, cpuPercent: 0 },
        { name: "nginx", status: "error", ramMb: 0, cpuPercent: 0 },
        { name: "admin-app", status: "error", ramMb: 0, cpuPercent: 0 }
      ]
    };
  }
} 