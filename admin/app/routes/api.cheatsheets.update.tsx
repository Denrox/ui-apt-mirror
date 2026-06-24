import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
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
    await execAsync(
      `git clone --depth 1 --single-branch https://github.com/tldr-pages/tldr.git "${tempDir}"`,
    );

    // Only wipe the existing cheatsheets once we've confirmed the clone
    // actually produced the page directories. Otherwise a failed/partial clone
    // would delete everything and leave the dir empty (cheatsheets disappear).
    const commonDir = path.join(tempDir, 'pages', 'common');
    const linuxDir = path.join(tempDir, 'pages', 'linux');
    await fs.access(commonDir);

    // -maxdepth 1: cheatsheets are stored flat at the top level, and tempDir
    // lives *inside* cheatsheetsDir — a recursive delete would also wipe the
    // freshly-cloned source pages under tempDir/pages/**, leaving nothing to
    // copy. Restrict the delete to the top-level .md files only.
    console.log('Removing existing .md files...');
    try {
      await execAsync(
        `find "${cheatsheetsDir}" -maxdepth 1 -name "*.md" -delete`,
      );
    } catch (error) {
      console.log('No existing .md files to remove');
    }

    console.log('Copying common pages...');
    await execAsync(`cp "${commonDir}"/*.md "${cheatsheetsDir}/"`);

    console.log('Copying linux pages...');
    try {
      await execAsync(`cp "${linuxDir}"/*.md "${cheatsheetsDir}/"`);
    } catch (error) {
      console.log('No linux pages to copy');
    }

    // Regenerating the category index is best-effort: the listing reads the
    // .md files directly, so a categories failure must not abort the update.
    console.log('Updating categories...');
    try {
      const { default: updateCategories } = await import('./update-categories');
      await updateCategories(cheatsheetsDir);
    } catch (error) {
      console.error('Failed to regenerate categories.json:', error);
    }

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
