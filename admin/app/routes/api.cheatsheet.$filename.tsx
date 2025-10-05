import { readFile } from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';

export async function loader({ request, params }: { request: Request; params: { filename: string } }) {
  const isPublicRoute = request.url.includes('/public-cheatsheets');
  
  if (!isPublicRoute) {
    await requireAuthMiddleware(request);
  }

  try {
    const { filename } = params;
    
    if (!filename.endsWith('.md') || 
        filename.includes('..') || 
        filename.includes('/') || 
        filename.includes('\\') || 
        filename.length > 255 ||
        filename.length === 0) {
      throw new Response('Invalid filename', { status: 400 });
    }

    const cheatsheetPath = path.join(process.cwd(), appConfig.cheatsheetsDir, filename);
    
    const content = await readFile(cheatsheetPath, 'utf-8');
    
    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Error loading cheatsheet:', error);
    
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new Response('Cheatsheet not found', { status: 404 });
    }
    
    throw new Response('Failed to load cheatsheet', { status: 500 });
  }
}
