import fs from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const isPublicRoute = url.hostname.startsWith('cheatsheets');
  
  if (!isPublicRoute) {
    await requireAuthMiddleware(request);
  }

  try {
    const cheatsheetsDir = appConfig.cheatsheetsDir;
    const categoriesPath = path.join(cheatsheetsDir, 'categories.json');

    // The .md files on disk are the source of truth for what exists. Read them
    // first so the list never disappears just because the category index is
    // missing or malformed (e.g. a failed/partial update).
    const files = await fs.readdir(cheatsheetsDir);
    const mdFiles = files.filter(file => file.endsWith('.md') && file !== 'README.md');

    // categories.json is a best-effort enrichment; fall back to no categories
    // rather than failing the whole page if it is absent or invalid.
    let categories: Record<string, unknown> = {};
    try {
      categories = JSON.parse(await fs.readFile(categoriesPath, 'utf-8'));
    } catch (categoriesError) {
      console.warn('cheatsheets: categories.json missing or invalid, listing without categories');
    }
    const filesWithCategories = mdFiles.map(file => {
      const fileName = file;
      const fileCategories: string[] = [];
      
      Object.entries(categories).forEach(([categoryName, categoryFiles]) => {
        if (Array.isArray(categoryFiles) && categoryFiles.includes(fileName)) {
          fileCategories.push(categoryName);
        }
      });
      
      if (fileCategories.length === 0) {
        fileCategories.push('Miscellaneous');
      }
      
      return {
        name: fileName,
        path: fileName,
                size: 0,
        isDirectory: false,
        categories: fileCategories
      };
    });
    
    const allCategories = Object.keys(categories).sort();
    
    return {
      files: filesWithCategories,
      categories: allCategories,
      currentPath: '',
      error: null
    };
  } catch (error) {
    console.error('Error loading cheatsheets:', error);
    return {
      files: [],
      categories: [],
      currentPath: '',
      error: 'Failed to load cheatsheets'
    };
  }
}
