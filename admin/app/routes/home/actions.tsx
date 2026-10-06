import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { configuredHosts, hostAddress } from '~/utils/hosts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  generateKey,
  deleteKey,
  signReleasesForHost,
  restoreUpstreamSignatures,
  assertValidHost,
} from '~/lib/gpg';
import { MirrorConfig, type RepositoryInput } from '~/utils/mirror-config';
import { atomicWriteFile, validateRepositoryInput, withMirrorListLock } from '~/utils/mirror-list';

const execFileAsync = promisify(execFile);

/** Run a control script; its last output line is the message shown to the user. */
async function runScript(path: string): Promise<{ ok: boolean; message: string }> {
  const lastLine = (out: unknown) =>
    String(out ?? '').trim().split('\n').pop()?.trim() ?? '';
  try {
    const { stdout } = await execFileAsync(path, [], { timeout: 60000 });
    return { ok: true, message: lastLine(stdout) };
  } catch (error: any) {
    console.error(`Error running ${path}:`, error);
    return { ok: false, message: lastLine(error?.stdout) };
  }
}

const STALE_ERROR =
  'This repository changed since you opened it (another tab or user saved it). Reload the page and try again.';

function formRevision(formData: FormData): string | undefined {
  const revision = formData.get('revision');
  return typeof revision === 'string' && revision !== '' ? revision : undefined;
}

/** A stale revision means the client acted on an outdated view of the section. */
function isStale(config: MirrorConfig, title: string, formData: FormData): boolean {
  const revision = formRevision(formData);
  const section = config.getSection(title, revision);
  return !!section && !!revision && revision !== config.sectionRevision(section);
}

function signedMessage(count: number): string {
  return count
    ? ` and signed ${count} Release file(s)`
    : '; no Release files are mirrored yet, they are signed after the next sync';
}

/** Host whose URL is embedded in client-facing Usage snippets. */
function mirrorDomain(): string {
  return hostAddress('mirror');
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
    arches: tokens(formData.get('arches')),
    // Only the UI-managed filter keys are sent; keys omitted here are preserved
    // by editSection (an empty array clears that directive).
    filters: {
      include_source_name: tokens(formData.get('includeSourceName')),
      include_binary_packages: tokens(formData.get('includeBinaryPackages')),
      exclude_binary_packages: tokens(formData.get('excludeBinaryPackages')),
      include_sections: tokens(formData.get('includeSections')),
    },
  };
}

export async function action({ request }: { request: Request }) {
  await requireAuthMiddleware(request);
  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'startSync') {
    const { ok, message } = await runScript(appConfig.startMirrorScriptPath);
    return ok
      ? { success: true, message: message || 'Mirror sync started' }
      : { error: message || 'Failed to start mirror sync' };
  }

  if (action === 'stopSync') {
    const { ok, message } = await runScript(appConfig.stopMirrorScriptPath);
    return ok
      ? { success: true, message: message || 'Mirror sync stopped' }
      : { error: message || 'Failed to stop mirror sync' };
  }

  if (action === 'removeRepository') {
    const sectionTitle = formData.get('sectionTitle') as string;
    if (!sectionTitle) return { error: 'Section title is required' };
    try {
      return await withMirrorListLock(async () => {
        const mirrorListPath = appConfig.mirrorListPath;
        const config = MirrorConfig.parse(await fs.readFile(mirrorListPath, 'utf-8'));
        if (!config.getSection(sectionTitle)) {
          return { error: `Repository section "${sectionTitle}" not found` };
        }
        if (isStale(config, sectionTitle, formData)) return { error: STALE_ERROR };

        config.removeSection(sectionTitle, formRevision(formData));
        await atomicWriteFile(mirrorListPath, config.serialize());
        return { success: true, message: `Repository "${sectionTitle}" removed` };
      });
    } catch (error) {
      console.error('Error removing repository section:', error);
      return { error: 'Failed to remove repository' };
    }
  }

  if (action === 'deleteRepository' || action === 'restoreRepository') {
    const sectionTitle = formData.get('sectionTitle') as string;
    if (!sectionTitle) {
      return { error: 'Section title is required' };
    }

    const enable = action === 'restoreRepository';
    try {
      return await withMirrorListLock(async () => {
        const mirrorListPath = appConfig.mirrorListPath;
        const content = await fs.readFile(mirrorListPath, 'utf-8');
        const config = MirrorConfig.parse(content);

        if (!config.getSection(sectionTitle)) {
          return { error: `Repository section "${sectionTitle}" not found` };
        }
        if (isStale(config, sectionTitle, formData)) return { error: STALE_ERROR };

        // Toggle only the deb and filter directives in the section; comments (the
        // description) and the client-facing Usage snippet are left untouched.
        config.setSectionEnabled(sectionTitle, enable, formRevision(formData));
        await atomicWriteFile(mirrorListPath, config.serialize());

        return {
          success: true,
          message: `Repository section "${sectionTitle}" ${
            enable ? 'enabled' : 'disabled'
          } successfully`,
        };
      });
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
      return await withMirrorListLock(async () => {
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
      });
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
      return await withMirrorListLock(async () => {
        const mirrorListPath = appConfig.mirrorListPath;
        const content = await fs.readFile(mirrorListPath, 'utf-8');
        const config = MirrorConfig.parse(content);

        if (!config.getSection(originalTitle)) {
          return { error: `Repository "${originalTitle}" not found` };
        }
        if (isStale(config, originalTitle, formData)) return { error: STALE_ERROR };

        // A rename to the same title is fine; only collisions with *other*
        // sections are rejected.
        const otherTitles = config
          .sectionTitles()
          .filter((t) => t !== originalTitle);
        const validationError = validateRepositoryInput(input, otherTitles);
        if (validationError) return { error: validationError };

        config.editSection(originalTitle, input, mirrorDomain(), formRevision(formData));
        await atomicWriteFile(mirrorListPath, config.serialize());

        return {
          success: true,
          message: `Repository "${input.title}" updated successfully`,
        };
      });
    } catch (error) {
      console.error('Error editing repository:', error);
      return { error: 'Failed to edit repository' };
    }
  }

  if (action === 'generateGpgKey') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      const config = MirrorConfig.parse(await fs.readFile(appConfig.mirrorListPath, 'utf-8'));
      if (!config.enabledHosts().includes(host)) {
        return { error: `${host} is not used by any enabled repository` };
      }
      const record = await generateKey(host);
      let message = `Generated signing key for ${host} (${record.keyId})`;
      try {
        message += signedMessage(await signReleasesForHost(host));
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
      const count = await signReleasesForHost(host);
      return {
        success: true,
        message: count
          ? `Re-signed ${count} Release file(s) for ${host}`
          : `No Release files mirrored for ${host} yet; they are signed after the next sync`,
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
      // Before the key goes: Release files signed with it would fail on every client.
      let restored = true;
      try {
        await restoreUpstreamSignatures(host);
      } catch (restoreError) {
        console.error('Restoring upstream signatures failed:', restoreError);
        restored = false;
      }
      await deleteKey(host);
      return {
        success: true,
        message: restored
          ? `Deleted signing key for ${host} and restored the upstream signatures`
          : `Deleted signing key for ${host}; restoring the upstream signatures failed, run a sync to fix them`,
      };
    } catch (error) {
      console.error('Error deleting GPG key:', error);
      const msg =
        error instanceof Error ? error.message : 'Failed to delete key';
      return { error: msg };
    }
  }

  if (action === 'checkHealth') {
    for (const host of configuredHosts()) {
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
