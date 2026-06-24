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
import { MirrorConfig, type RepositoryInput } from '~/utils/mirror-config';
import { atomicWriteFile, validateRepositoryInput } from '~/utils/mirror-list';

const execAsync = promisify(exec);

/** Host whose URL is embedded in client-facing Usage snippets. */
function mirrorDomain(): string {
  return (
    appConfig.hosts.find((h) => h.id === 'mirror')?.address ?? 'mirror.intra'
  );
}

/** Split a whitespace/comma-separated form field into trimmed tokens. */
function tokens(value: FormDataEntryValue | null): string[] {
  return ((value as string) ?? '')
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Read the repository form fields into a {@link RepositoryInput}. */
function readRepositoryInput(formData: FormData): RepositoryInput {
  return {
    title: ((formData.get('title') as string) ?? '').trim(),
    description: ((formData.get('description') as string) ?? '').trim(),
    baseUrl: ((formData.get('baseUrl') as string) ?? '').trim(),
    suites: tokens(formData.get('suites')),
    components: tokens(formData.get('components')),
    includeSrc: formData.get('includeSrc') === 'true',
    trusted: formData.get('trusted') === 'true',
  };
}

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

  if (action === 'deleteRepository' || action === 'restoreRepository') {
    const sectionTitle = formData.get('sectionTitle') as string;
    if (!sectionTitle) {
      return { error: 'Section title is required' };
    }

    const enable = action === 'restoreRepository';
    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const config = MirrorConfig.parse(content);

      if (!config.getSection(sectionTitle)) {
        return { error: `Repository section "${sectionTitle}" not found` };
      }

      // Toggle only the deb/deb-src directives in the section; comments (the
      // description) and the client-facing Usage snippet are left untouched.
      config.setSectionEnabled(sectionTitle, enable);
      await atomicWriteFile(mirrorListPath, config.serialize());

      return {
        success: true,
        message: `Repository section "${sectionTitle}" ${
          enable ? 'enabled' : 'disabled'
        } successfully`,
      };
    } catch (error) {
      console.error('Error toggling repository section:', error);
      return {
        error: `Failed to ${enable ? 'enable' : 'disable'} repository section`,
      };
    }
  }

  if (action === 'addRepository') {
    const input = readRepositoryInput(formData);
    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const config = MirrorConfig.parse(content);

      const validationError = validateRepositoryInput(
        input,
        config.sectionTitles(),
      );
      if (validationError) return { error: validationError };

      config.addSection(input, mirrorDomain());
      await atomicWriteFile(mirrorListPath, config.serialize());

      return {
        success: true,
        message: `Repository "${input.title}" added successfully`,
      };
    } catch (error) {
      console.error('Error adding repository:', error);
      return { error: 'Failed to add repository' };
    }
  }

  if (action === 'editRepository') {
    const originalTitle = (
      (formData.get('originalTitle') as string) ?? ''
    ).trim();
    if (!originalTitle) return { error: 'Original title is required' };
    const input = readRepositoryInput(formData);

    try {
      const mirrorListPath = appConfig.mirrorListPath;
      const content = await fs.readFile(mirrorListPath, 'utf-8');
      const config = MirrorConfig.parse(content);

      if (!config.getSection(originalTitle)) {
        return { error: `Repository "${originalTitle}" not found` };
      }

      // A rename to the same title is fine; only collisions with *other*
      // sections are rejected.
      const otherTitles = config
        .sectionTitles()
        .filter((t) => t !== originalTitle);
      const validationError = validateRepositoryInput(input, otherTitles);
      if (validationError) return { error: validationError };

      config.editSection(originalTitle, input, mirrorDomain());
      await atomicWriteFile(mirrorListPath, config.serialize());

      return {
        success: true,
        message: `Repository "${input.title}" updated successfully`,
      };
    } catch (error) {
      console.error('Error editing repository:', error);
      return { error: 'Failed to edit repository' };
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
        console.error(
          'Initial signing after key generation failed:',
          signError,
        );
        message += ' (initial signing failed — will retry on next sync)';
      }
      return { success: true, message };
    } catch (error) {
      console.error('Error generating GPG key:', error);
      const msg =
        error instanceof Error ? error.message : 'Failed to generate key';
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
      const msg =
        error instanceof Error ? error.message : 'Failed to sign Release';
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
      const msg =
        error instanceof Error ? error.message : 'Failed to delete key';
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
