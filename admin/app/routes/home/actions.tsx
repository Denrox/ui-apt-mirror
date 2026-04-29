import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import {
  generateKey,
  deleteKey,
  signReleasesForHost,
  assertValidHost,
} from '~/lib/gpg';

const execAsync = promisify(exec);

export async function action({ request }: { request: Request }) {
  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'startSync') {
    try {
      const child = spawn(appConfig.startMirrorScriptPath, [], {
        stdio: 'pipe',
        detached: true,
      });

      child.unref();

      return { success: true, message: 'Mirror sync started successfully' };
    } catch (error) {
      console.error('Error starting mirror sync:', error);
      return { error: 'Failed to start mirror sync' };
    }
  }

  if (action === 'stopSync') {
    try {
      await execAsync(appConfig.stopMirrorScriptPath);
      return { success: true, message: 'Mirror sync stopped successfully' };
    } catch (error) {
      console.error('Error stopping mirror sync:', error);
      return { error: 'Failed to stop mirror sync' };
    }
  }

  if (action === 'deleteRepository') {
    const sectionTitle = formData.get('sectionTitle') as string;

    if (!sectionTitle) {
      return { error: 'Section title is required' };
    }

    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const lines = content.split('\n');

      const newLines: string[] = [];
      let inTargetSection = false;
      let inUsageSection = false;

      for (const line of lines) {
        const startMatch = /# ---start---(.+?)---/.exec(line);
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

        const endMatch = /# ---end---(.+?)---/.exec(line);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line);
          continue;
        }

        if (
          inTargetSection &&
          !inUsageSection &&
          line.trim() &&
          !line.startsWith('#')
        ) {
          newLines.push(`# ${line}`);
        } else {
          newLines.push(line);
        }
      }

      await fs.writeFile(mirrorListPath, newLines.join('\n'));

      return {
        success: true,
        message: `Repository section "${sectionTitle}" commented successfully`,
      };
    } catch (error) {
      return { error: 'Failed to comment repository section' };
    }
  }

  if (action === 'restoreRepository') {
    const sectionTitle = formData.get('sectionTitle') as string;

    if (!sectionTitle) {
      return { error: 'Section title is required' };
    }

    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const lines = content.split('\n');

      const newLines: string[] = [];
      let inTargetSection = false;
      let inUsageSection = false;

      for (const line of lines) {
        const startMatch = /# ---start---(.+?)---/.exec(line);
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

        const endMatch = /# ---end---(.+?)---/.exec(line);
        if (endMatch && inTargetSection) {
          inTargetSection = false;
          inUsageSection = false;
          newLines.push(line);
          continue;
        }

        if (
          inTargetSection &&
          !inUsageSection &&
          line.trim().startsWith('# ')
        ) {
          newLines.push(line.substring(2));
        } else {
          newLines.push(line);
        }
      }

      await fs.writeFile(mirrorListPath, newLines.join('\n'));

      return {
        success: true,
        message: `Repository section "${sectionTitle}" enabled successfully`,
      };
    } catch (error) {
      return { error: 'Failed to enable repository section' };
    }
  }

  if (action === 'generateGpgKey') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      const record = await generateKey(host);
      let message = `Generated signing key for ${host} (${record.keyId})`;
      try {
        await signReleasesForHost(host);
        message += ' and signed Release files';
      } catch (signError) {
        console.error('Initial signing after key generation failed:', signError);
        message += ' (initial signing failed — will retry on next sync)';
      }
      return { success: true, message };
    } catch (error) {
      console.error('Error generating GPG key:', error);
      const msg = error instanceof Error ? error.message : 'Failed to generate key';
      return { error: msg };
    }
  }

  if (action === 'signRelease') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      await signReleasesForHost(host);
      return {
        success: true,
        message: `Re-signed Release files for ${host}`,
      };
    } catch (error) {
      console.error('Error signing release:', error);
      const msg = error instanceof Error ? error.message : 'Failed to sign Release';
      return { error: msg };
    }
  }

  if (action === 'deleteGpgKey') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      await deleteKey(host);
      return { success: true, message: `Deleted signing key for ${host}` };
    } catch (error) {
      console.error('Error deleting GPG key:', error);
      const msg = error instanceof Error ? error.message : 'Failed to delete key';
      return { error: msg };
    }
  }

  if (action === 'checkHealth') {
    for (const host of appConfig.hosts) {
      if (host.id === 'admin') {
        try {
          const response = await fetch(`http://${host.address}/api/health`);
          if (response.ok) {
            const healthData = await response.json();
            if (healthData.status === 'healthy') {
              return { success: true, message: 'Admin service is healthy' };
            }
          }
        } catch (error) {
          console.error('Error checking admin health:', error);
        }
      }
    }
    return { error: 'Admin service not found or not healthy' };
  }

  return { error: 'Invalid action' };
}
