import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';
import { Readable } from 'stream';

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

    const decodedPath = decodeURIComponent(filePath);
    const normalizedFilePath = path.resolve(decodedPath);
    const normalizedPrivateFilesDir = path.resolve(appConfig.privateFilesDir);

    if (!normalizedFilePath.startsWith(normalizedPrivateFilesDir)) {
      console.error(
        'Security violation: Attempted to access file outside private files directory:',
        normalizedFilePath,
      );
      throw new Response('Access denied: File not in private files directory', { status: 403 });
    }

    if (normalizedFilePath.includes('..')) {
      throw new Response('Invalid file path', { status: 400 });
    }

    const fileStats = await stat(normalizedFilePath);

    if (fileStats.isDirectory()) {
      throw new Response('Path is a directory, not a file', { status: 400 });
    }

    const fileName = path.basename(normalizedFilePath);
    const contentType = getContentType(normalizedFilePath);
    
    const fileStream = createReadStream(normalizedFilePath);
    const webStream = Readable.toWeb(fileStream) as ReadableStream;

    return new Response(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': fileStats.size.toString(),
      },
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

