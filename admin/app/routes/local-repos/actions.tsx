import fs from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import {
  createRepo,
  deleteRepo,
  publishRepo,
  deletePackage,
  ensurePoolDir,
  assertDebFilename,
} from '~/lib/local-repo';
import {
  assertValidHost,
  generateKey,
  deleteKey,
  signReleasesForHost,
} from '~/lib/gpg';

interface ActionResult {
  success?: boolean;
  message?: string;
  error?: string;
}

// In-flight chunked .deb uploads, keyed by client-generated fileId.
const chunkStorage = new Map<
  string,
  { tempDir: string; totalChunks: number; fileName: string; host: string }
>();

function splitTokens(value: FormDataEntryValue | null): string[] {
  return (typeof value === 'string' ? value : '')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

async function handleDebChunk(formData: FormData): Promise<ActionResult> {
  const host = formData.get('host') as string;
  const component = formData.get('component') as string;
  const chunk = formData.get('chunk') as any;
  const chunkIndex = parseInt(formData.get('chunkIndex') as string);
  const totalChunks = parseInt(formData.get('totalChunks') as string);
  const fileName = formData.get('fileName') as string;
  const rawFileId = formData.get('fileId') as string;

  if (!chunk || !fileName || !rawFileId || !host || !component) {
    return { error: 'Missing required upload data' };
  }

  try {
    assertDebFilename(fileName);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid file' };
  }

  const fileId = rawFileId.replace(/[^a-z0-9]/gi, '');
  if (!fileId) return { error: 'Invalid upload id' };

  let chunkBuffer: Buffer;
  try {
    if (typeof chunk?.arrayBuffer === 'function') {
      chunkBuffer = Buffer.from(await chunk.arrayBuffer());
    } else if (chunk?.buffer) {
      chunkBuffer = chunk.buffer;
    } else {
      return { error: 'Invalid chunk format' };
    }
  } catch {
    return { error: 'Failed to read chunk data' };
  }

  try {
    if (!chunkStorage.has(fileId)) {
      const poolDir = await ensurePoolDir(host, component);
      const tempDir = path.join(poolDir, `.tmp-${fileId}`);
      await fs.mkdir(tempDir, { recursive: true });
      chunkStorage.set(fileId, { tempDir, totalChunks, fileName, host });
    }

    const info = chunkStorage.get(fileId)!;
    const tempFile = path.join(info.tempDir, `${fileName}.temp`);

    if (chunkIndex === 0) {
      await fs.writeFile(tempFile, chunkBuffer);
    } else {
      await fs.appendFile(tempFile, chunkBuffer);
    }

    if (chunkIndex === totalChunks - 1) {
      const poolDir = await ensurePoolDir(host, component);
      await fs.rename(tempFile, path.join(poolDir, fileName));
      await fs.rm(info.tempDir, { recursive: true, force: true });
      chunkStorage.delete(fileId);

      // Regenerate indexes + Release and re-sign (if the repo has a key).
      await publishRepo(host);
      return { success: true, message: `Uploaded ${fileName}` };
    }

    return { success: true, message: 'Chunk processed' };
  } catch (error) {
    chunkStorage.delete(fileId);
    console.error('Error uploading .deb chunk:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to upload package',
    };
  }
}

export async function action({
  request,
}: {
  request: Request;
}): Promise<ActionResult> {
  await requireAuthMiddleware(request);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent === 'uploadChunk') {
    return handleDebChunk(formData);
  }

  if (intent === 'createRepo') {
    try {
      const repo = await createRepo({
        name: (formData.get('name') as string) ?? '',
        suite: (formData.get('suite') as string) ?? '',
        components: splitTokens(formData.get('components')),
        arches: splitTokens(formData.get('arches')),
        origin: (formData.get('origin') as string) ?? '',
        label: (formData.get('label') as string) ?? '',
      });
      return {
        success: true,
        message: `Local repository "${repo.host}" created`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to create repo',
      };
    }
  }

  if (intent === 'deleteRepo') {
    const host = formData.get('host') as string;
    try {
      await deleteRepo(host);
      return { success: true, message: `Local repository "${host}" removed` };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to remove repo',
      };
    }
  }

  if (intent === 'publishRepo') {
    const host = formData.get('host') as string;
    try {
      await publishRepo(host);
      return { success: true, message: `Republished "${host}"` };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to republish',
      };
    }
  }

  if (intent === 'deletePackage') {
    const host = formData.get('host') as string;
    const component = formData.get('component') as string;
    const filename = formData.get('filename') as string;
    try {
      await deletePackage(host, component, filename);
      return { success: true, message: `Removed ${filename}` };
    } catch (error) {
      return {
        error:
          error instanceof Error ? error.message : 'Failed to remove package',
      };
    }
  }

  if (intent === 'generateGpgKey') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      const record = await generateKey(host);
      let message = `Generated signing key for ${host} (${record.keyId})`;
      try {
        await signReleasesForHost(host);
        message += ' and signed Release';
      } catch {
        message += ' (signing will retry on next publish)';
      }
      return { success: true, message };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to generate key',
      };
    }
  }

  if (intent === 'signRelease') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      await signReleasesForHost(host);
      return { success: true, message: `Re-signed Release for ${host}` };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to sign Release',
      };
    }
  }

  if (intent === 'deleteGpgKey') {
    const host = formData.get('host') as string;
    try {
      assertValidHost(host);
      await deleteKey(host);
      // Re-publish so Release.gpg/InRelease are dropped from the served tree.
      await publishRepo(host).catch(() => undefined);
      return { success: true, message: `Deleted signing key for ${host}` };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to delete key',
      };
    }
  }

  return { error: 'Invalid action' };
}
