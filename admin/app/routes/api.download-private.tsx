import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import { resolveInside } from '~/utils/safe-path';
import appConfig from '~/config/config.json';
import { Readable } from 'stream';
import { parseRange } from '~/utils/byte-range';

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.html': 'text/html',
    '.md': 'text/markdown',
  };
  
  return contentTypes[ext] || 'application/octet-stream';
}

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  try {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');

    if (!filePath) {
      throw new Response('File path is required', { status: 400 });
    }

    // searchParams already decoded the path; resolveInside follows symlinks and
    // does not mistake a sibling such as files-private-x for the private root.
    const normalizedFilePath = resolveInside(filePath, [appConfig.privateFilesDir]);

    if (!normalizedFilePath) {
      console.error(
        'Security violation: Attempted to access file outside private files directory:',
        filePath,
      );
      throw new Response('Access denied: File not in private files directory', { status: 403 });
    }

    const fileStats = await stat(normalizedFilePath);

    if (fileStats.isDirectory()) {
      throw new Response('Path is a directory, not a file', { status: 400 });
    }

    const fileName = path.basename(normalizedFilePath);
    const contentType = getContentType(normalizedFilePath);
    const lastModified = fileStats.mtime.toUTCString();
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Accept-Ranges': 'bytes',
      'Last-Modified': lastModified,
    };

    // A single range, so an interrupted download can resume; If-Range for another version
    // of the file gets the whole file.
    const ifRange = request.headers.get('if-range');
    const range =
      ifRange && ifRange !== lastModified
        ? null
        : parseRange(request.headers.get('range'), fileStats.size);
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${fileStats.size}` },
      });
    }

    const fileStream = range
      ? createReadStream(normalizedFilePath, { start: range.start, end: range.end })
      : createReadStream(normalizedFilePath);
    const webStream = Readable.toWeb(fileStream) as ReadableStream;

    if (range) {
      return new Response(webStream, {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${fileStats.size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }
    return new Response(webStream, {
      headers: { ...headers, 'Content-Length': fileStats.size.toString() },
    });
  } catch (error) {
    console.error('Error downloading private file:', error);

    if (error instanceof Response) {
      throw error;
    }

    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Response('File not found', { status: 404 });
    }

    throw new Response('Failed to download file', { status: 500 });
  }
}

