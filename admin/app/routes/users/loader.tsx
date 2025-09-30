import { readFileSync } from 'fs';
import appConfig from '~/config/config.json';

export async function loader({ request }: { request: Request }) {
  const { requireAuth } = await import('~/utils/server-auth');
  const user = await requireAuth(request);

  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
  }

  if (user.username !== 'admin') {
    throw new Response('Forbidden', { status: 403 });
  }

  try {
    const htpasswdPath = appConfig.htpasswdPath;
    const htpasswdContent = readFileSync(htpasswdPath, 'utf-8');
    const lines = htpasswdContent.split('\n').filter((line) => line.trim());

    const users = lines
      .filter((line) => !line.startsWith('#') && line.includes(':'))
      .map((line) => {
        const colonIndex = line.indexOf(':');
        const username = line.substring(0, colonIndex);
        return { username };
      });

    return { users, currentUser: user.username };
  } catch (error) {
    console.error('Error reading users:', error);
    return { users: [], currentUser: user.username, error: 'Failed to load users' };
  }
}
