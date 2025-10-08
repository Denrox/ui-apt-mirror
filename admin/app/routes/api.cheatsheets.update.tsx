import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { requireAuthMiddleware } from '~/utils/auth-middleware';
import appConfig from '~/config/config.json';

const execAsync = promisify(exec);

export async function action({ request }: { request: Request }) {
  await requireAuthMiddleware(request);

  if (request.method !== 'POST') {
    throw new Response('Method not allowed', { status: 405 });
  }

  try {
    const formData = await request.formData();
    const intent = formData.get('intent');

    if (intent !== 'updateCheatsheets') {
      throw new Response('Invalid intent', { status: 400 });
    }

    const tempDir = path.join(appConfig.cheatsheetsDir, 'temp-tldr-update');
    const cheatsheetsDir = appConfig.cheatsheetsDir;

    console.log('Starting cheatsheets update...');
    try {
      await execAsync(`rm -rf "${tempDir}"`);
    } catch (error) {
    }

    console.log('Cloning tldr-pages repository...');
    await execAsync(`git clone https://github.com/tldr-pages/tldr.git "${tempDir}"`);

    console.log('Removing existing .md files...');
    try {
      await execAsync(`find "${cheatsheetsDir}" -name "*.md" -delete`);
    } catch (error) {
      console.log('No existing .md files to remove');
    }

    console.log('Copying common pages...');
    await execAsync(`cp "${tempDir}/pages/common"/*.md "${cheatsheetsDir}/"`);

    console.log('Copying linux pages...');
    await execAsync(`cp "${tempDir}/pages/linux"/*.md "${cheatsheetsDir}/"`);

    console.log('Updating categories...');
    const { default: updateCategories } = await import('./update-categories');
    await updateCategories(cheatsheetsDir);

    console.log('Cleaning up...');
    await execAsync(`rm -rf "${tempDir}"`);

    console.log('Cheatsheets update completed successfully');

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Cheatsheets updated successfully',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error('Error updating cheatsheets:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update cheatsheets'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
