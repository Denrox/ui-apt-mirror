import fs from 'fs/promises';
import appConfig from '~/config/config.json';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { hostAddress } from '~/utils/hosts';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  generateKey,
  deleteKey,
  getKey,
  signReleasesForHost,
  restoreUpstreamSignatures,
  assertValidHost,
} from '~/lib/gpg';
import { MirrorConfig, type RepositoryInput } from '~/utils/mirror-config';
import { atomicWriteFile, validateRepositoryInput, withMirrorListLock } from '~/utils/mirror-list';
import { checkLockFile } from '~/utils/sync';
import { deleteMirrorDirs, unusedMirrorDirs } from '~/utils/mirror-data';
import path from 'path';

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
const NO_REVISION_ERROR = 'The request did not say which version of the repository it changes. Reload the page and try again.';
const SYNC_RUNNING_ERROR = 'A sync is running. Wait for it to finish (or stop it) before changing repositories.';
const NOT_EDITABLE_ERROR =
  'This repository has several upstreams or component sets and cannot be edited in the form.';

function formRevision(formData: FormData): string | undefined {
  const revision = formData.get('revision');
  return typeof revision === 'string' && revision !== '' ? revision : undefined;
}

/**
 * Why a change to an existing section must be refused: no revision (the client did not say
 * which version it saw) or a stale one (it acted on an outdated view of the section).
 */
function revisionError(config: MirrorConfig, title: string, formData: FormData): string | null {
  const revision = formRevision(formData);
  if (!revision) return NO_REVISION_ERROR;
  const section = config.getSection(title, revision);
  return section && revision !== config.sectionRevision(section) ? STALE_ERROR : null;
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

  const changesRepositories = [
    'addRepository',
    'editRepository',
    'removeRepository',
    'deleteRepository',
    'restoreRepository',
  ].includes(action as string);
  // The dashboard disables these while a sync runs; refuse them from other clients too.
  if (changesRepositories && (await checkLockFile())) return { error: SYNC_RUNNING_ERROR };

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
        const staleError = revisionError(config, sectionTitle, formData);
        if (staleError) return { error: staleError };

        const section = config.getSection(sectionTitle, formRevision(formData))!;
        const uris = section.children.flatMap((c) => (c.kind === 'deb' ? [c.uri] : []));
        config.removeSection(sectionTitle, formRevision(formData));
        await atomicWriteFile(mirrorListPath, config.serialize());
        if (formData.get('deleteData') !== 'true') {
          return { success: true, message: `Repository "${sectionTitle}" removed` };
        }

        // apt-mirror2 never cleans an upstream that is no longer configured, so its files
        // would stay on disk (and served) for good.
        const dirs = unusedMirrorDirs(config, uris);
        const roots = [appConfig.mirrorRoot, path.join(path.dirname(appConfig.mirrorRoot), 'skel')];
        const deleted = dirs.length ? await deleteMirrorDirs(dirs, roots) : [];
        return {
          success: true,
          message: deleted.length
            ? `Repository "${sectionTitle}" removed and its mirrored files deleted`
            : dirs.length
              ? `Repository "${sectionTitle}" removed; it had no mirrored files`
              : `Repository "${sectionTitle}" removed; its mirrored files are kept because another enabled repository uses the same upstream`,
        };
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
        const staleError = revisionError(config, sectionTitle, formData);
        if (staleError) return { error: staleError };

        // Toggle only the deb and filter directives in the section; comments (the
        // description) and the client-facing Usage snippet are left untouched.
        const section = config.getSection(sectionTitle, formRevision(formData))!;
        config.setEnabled(section, enable);
        // Enabling can put an unfiltered and a filtered repository on one upstream.
        const conflict = config.filterConflict(section);
        if (conflict) return { error: conflict };
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
        const added = config.sections().filter((s) => s.title === input.title.trim()).pop();
        const conflict = added && config.filterConflict(added);
        if (conflict) return { error: conflict };
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
        const staleError = revisionError(config, originalTitle, formData);
        if (staleError) return { error: staleError };

        // The form rebuilds the whole section: one that it cannot represent would lose its
        // other sources (e.g. Debian's security.debian.org lines).
        const section = config.getSection(originalTitle, formRevision(formData))!;
        if (!config.sectionToInput(section)) return { error: NOT_EDITABLE_ERROR };
        const wasEnabled = config.isSectionEnabled(section);

        // A rename to the same title is fine; only collisions with *other*
        // sections are rejected.
        const otherTitles = config
          .sectionTitles()
          .filter((t) => t !== originalTitle);
        const validationError = validateRepositoryInput(input, otherTitles);
        if (validationError) return { error: validationError };

        config.editSection(originalTitle, input, mirrorDomain(), formRevision(formData));
        // Editing never enables a disabled repository (the next sync would download it).
        if (!wasEnabled) config.setEnabled(section, false);
        const conflict = config.filterConflict(section);
        if (conflict) return { error: conflict };
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
      if (!(await getKey(host))) return { error: `There is no signing key for ${host}` };
      // Before the key goes: Release files signed with it would fail on every client.
      let restored = true;
      let unrestored = 0;
      try {
        unrestored = await restoreUpstreamSignatures(host);
      } catch (restoreError) {
        console.error('Restoring upstream signatures failed:', restoreError);
        restored = false;
      }
      if (!(await deleteKey(host))) return { error: `There is no signing key for ${host}` };
      return {
        success: true,
        message: !restored
          ? `Deleted signing key for ${host}; restoring the upstream signatures failed, run a sync to fix them`
          : unrestored
            ? `Deleted signing key for ${host}. ${unrestored} Release file(s) had no saved upstream signature and stay signed with the deleted key until the next sync; run a sync to restore them`
            : `Deleted signing key for ${host} and restored the upstream signatures`,
      };
    } catch (error) {
      console.error('Error deleting GPG key:', error);
      const msg =
        error instanceof Error ? error.message : 'Failed to delete key';
      return { error: msg };
    }
  }

  return { error: 'Invalid action' };
}
