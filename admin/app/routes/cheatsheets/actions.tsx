import { unlink, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';

export async function action({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  if (request.method !== 'POST') {
    throw new Response('Method not allowed', { status: 405 });
  }

  try {
    const formData = await request.formData();
    const intent = formData.get('intent') as string;
    const filename = formData.get('filename') as string;

    if (intent === 'deleteCheatsheet') {
      if (!filename) {
        return {
          success: false,
          error: 'Filename is required',
        };
      }

      if (!filename.endsWith('.md') || 
          filename.includes('..') || 
          filename.includes('/') || 
          filename.includes('\\') || 
          filename.length > 255 ||
          filename.length === 0) {
        return {
          success: false,
          error: 'Invalid filename',
        };
      }

      const cheatsheetPath = path.join(appConfig.cheatsheetsDir, filename);

      try {
        await readFile(cheatsheetPath);
        
        await unlink(cheatsheetPath);

        const categoriesPath = path.join(appConfig.cheatsheetsDir, 'categories.json');
        try {
          const categoriesContent = await readFile(categoriesPath, 'utf-8');
          const categories = JSON.parse(categoriesContent);
          
          Object.keys(categories).forEach(categoryName => {
            categories[categoryName] = categories[categoryName].filter((file: string) => file !== filename);
          });
          
          await writeFile(categoriesPath, JSON.stringify(categories, null, 2));
        } catch (error) {
          console.warn('Failed to update categories.json:', error);
        }

        console.log(`Deleted cheatsheet: ${filename}`);

        return {
          success: true,
          message: `Cheatsheet "${filename}" deleted successfully`,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('ENOENT')) {
          return {
            success: false,
            error: 'Cheatsheet not found',
          };
        }
        throw error;
      }
    }

    return {
      success: false,
      error: 'Invalid intent',
    };
  } catch (error) {
    console.error('Error in cheatsheets action:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process request',
    };
  }
}
