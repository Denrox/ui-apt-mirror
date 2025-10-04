import fs from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';

export async function loader({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  try {
    const cheatsheetsDir = path.join(process.cwd(), appConfig.cheatsheetsDir);
    const categoriesPath = path.join(cheatsheetsDir, 'categories.json');
    
    const categoriesContent = await fs.readFile(categoriesPath, 'utf-8');
    const categories = JSON.parse(categoriesContent);
    
    const files = await fs.readdir(cheatsheetsDir);
    const mdFiles = files.filter(file => file.endsWith('.md') && file !== 'README.md');
    
    const filesWithCategories = mdFiles.map(file => {
      const fileName = file;
      const fileCategories: string[] = [];
      
      Object.entries(categories).forEach(([categoryName, categoryFiles]) => {
        if (categoryFiles.includes(fileName)) {
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
