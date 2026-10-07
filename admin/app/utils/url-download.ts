import fs from 'fs/promises';
import fsSync from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { pipeline } from 'stream/promises';
import { nameTakenError, UPLOAD_TEMP_PREFIX } from './chunk-upload';
import { giveToDirOwner } from './file-owner';

export const DOWNLOAD_TEMP_PREFIX = `${UPLOAD_TEMP_PREFIX}dl-`;
export const DOWNLOAD_CANCELLED = 'Download cancelled';

export type DownloadResult = { ok: true } | { ok: false; error: string };

export interface Download {
  /** Settles once the download is stored under its name, or failed and left nothing behind. */
  done: Promise<DownloadResult>;
  cancel(): void;
}

export interface DownloadOptions {
  /** Longest wait for the server to send anything (connect, headers or more of the body). */
  idleTimeoutMs?: number;
  maxRedirects?: number;
}

class DownloadError extends Error {}

/**
 * Downloads `url` to `destPath`. The body goes to a hidden temp dir next to it and is linked
 * into place only when complete, so a stalled, broken or cancelled transfer never leaves a
 * partial file under the final name, and an existing file there is never replaced.
 * Redirects are followed (http and https only).
 */
export function startDownload(url: string, destPath: string, options: DownloadOptions = {}): Download {
  const { idleTimeoutMs = 30_000, maxRedirects = 5 } = options;
  let current: http.ClientRequest | null = null;
  // Why we stopped the transfer ourselves; the stream errors that follow are less telling.
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    stopReason ??= reason;
    current?.destroy(new DownloadError(reason));
  };
  const cancel = () => stop(DOWNLOAD_CANCELLED);

  const get = (target: URL) =>
    new Promise<http.IncomingMessage>((resolve, reject) => {
      if (stopReason) return reject(new DownloadError(stopReason));
      const client = target.protocol === 'https:' ? https : http;
      const request = client.get(target, resolve);
      current = request;
      request.on('error', reject);
      request.setTimeout(idleTimeoutMs, () => stop('The server stopped responding'));
    });

  const run = async (): Promise<DownloadResult> => {
    let target = parseHttpUrl(url);
    let response = await get(target);
    for (let redirects = 0; isRedirect(response.statusCode) && response.headers.location; redirects++) {
      response.resume();
      if (redirects >= maxRedirects) throw new DownloadError('Too many redirects');
      target = parseHttpUrl(new URL(response.headers.location, target).toString());
      response = await get(target);
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new DownloadError(`The server answered ${response.statusCode}`);
    }

    const tempDir = await fs.mkdtemp(path.join(path.dirname(destPath), DOWNLOAD_TEMP_PREFIX));
    try {
      const tempFile = path.join(tempDir, 'part');
      // pipeline destroys both streams and rejects on a reset, an abort or a timeout.
      await pipeline(response, fsSync.createWriteStream(tempFile, { flags: 'wx' }));
      if (stopReason) throw new DownloadError(stopReason);
      try {
        await fs.link(tempFile, destPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new DownloadError(nameTakenError(path.basename(destPath)));
        }
        throw error;
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
    giveToDirOwner(destPath);
    return { ok: true };
  };

  const done = run().catch((error): DownloadResult => {
    current?.destroy();
    if (stopReason) return { ok: false, error: stopReason };
    return { ok: false, error: error instanceof DownloadError ? error.message : 'The transfer failed' };
  });
  return { done, cancel };
}

function parseHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DownloadError('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DownloadError('Only http and https URLs are supported');
  }
  return parsed;
}

const isRedirect = (status?: number) => status !== undefined && [301, 302, 303, 307, 308].includes(status);
