import { appendFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import appConfig from '~/config/config.json';

export async function action({ request }: { request: Request }) {
  const { requireAuth } = await import('~/utils/server-auth');
  const user = await requireAuth(request);

  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    });
  }

  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  // Check if user is admin for admin-only actions
  const isAdmin = user.username === 'admin';

  if (intent === 'changePassword') {
    const username = formData.get('username') as string;
    const newPassword = formData.get('newPassword') as string;

    if (!username || !newPassword) {
      return {
        success: false,
        error: 'Username and new password are required',
      };
    }

    // Non-admin users can only change their own password
    if (!isAdmin && username !== user.username) {
      return {
        success: false,
        error: 'You can only change your own password',
      };
    }

    if (newPassword.length < 4) {
      return {
        success: false,
        error: 'Password must be at least 4 characters long',
      };
    }

    try {
      const htpasswdPath = appConfig.htpasswdPath;
      const htpasswdContent = readFileSync(htpasswdPath, 'utf-8');
      const lines = htpasswdContent.split('\n');

      const escapedPassword = newPassword.replace(/'/g, "'\\''");
      const passwordHash = execSync(
        `printf '%s' '${escapedPassword}' | openssl passwd -6 -stdin`,
        { encoding: 'utf-8' },
      ).trim();

      let userFound = false;
      const updatedLines = lines.map((line) => {
        if (!line.trim() || line.startsWith('#') || !line.includes(':')) {
          return line;
        }

        const colonIndex = line.indexOf(':');
        const existingUsername = line.substring(0, colonIndex);

        if (existingUsername === username) {
          userFound = true;
          return `${username}:${passwordHash}`;
        }

        return line;
      });

      if (!userFound) {
        return { success: false, error: 'User not found' };
      }

      const { writeFileSync } = await import('fs');
      writeFileSync(htpasswdPath, updatedLines.join('\n'));

      return {
        success: true,
        message: `Password changed successfully for ${username}`,
      };
    } catch (error) {
      console.error('Error changing password:', error);
      return { success: false, error: 'Failed to change password' };
    }
  }

  if (intent === 'deleteUser') {
    if (!isAdmin) {
      return { success: false, error: 'Only admin can delete users' };
    }

    const username = formData.get('username') as string;

    if (!username) {
      return { success: false, error: 'Username is required' };
    }

    if (username === 'admin') {
      return { success: false, error: 'Cannot delete admin user' };
    }

    try {
      const htpasswdPath = appConfig.htpasswdPath;
      const htpasswdContent = readFileSync(htpasswdPath, 'utf-8');
      const lines = htpasswdContent.split('\n');

      const filteredLines = lines.filter((line) => {
        if (!line.trim() || line.startsWith('#')) return true;
        if (!line.includes(':')) return true;

        const colonIndex = line.indexOf(':');
        const existingUsername = line.substring(0, colonIndex);
        return existingUsername !== username;
      });

      const { writeFileSync } = await import('fs');
      writeFileSync(htpasswdPath, filteredLines.join('\n'));

      return {
        success: true,
        message: `User ${username} deleted successfully`,
      };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: 'Failed to delete user' };
    }
  }

  if (intent === 'addUser') {
    if (!isAdmin) {
      return { success: false, error: 'Only admin can add users' };
    }

    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return {
        success: false,
        error:
          'Username can only contain letters, numbers, hyphens, and underscores',
      };
    }

    try {
      const htpasswdPath = appConfig.htpasswdPath;
      const htpasswdContent = readFileSync(htpasswdPath, 'utf-8');
      const lines = htpasswdContent.split('\n').filter((line) => line.trim());

      const existingUser = lines.find((line) => {
        if (line.startsWith('#') || !line.includes(':')) return false;
        const colonIndex = line.indexOf(':');
        const existingUsername = line.substring(0, colonIndex);
        return existingUsername === username;
      });

      if (existingUser) {
        return { success: false, error: 'User already exists' };
      }

      const escapedPassword = password.replace(/'/g, "'\\''");
      const passwordHash = execSync(
        `printf '%s' '${escapedPassword}' | openssl passwd -6 -stdin`,
        { encoding: 'utf-8' },
      ).trim();

      appendFileSync(htpasswdPath, `${username}:${passwordHash}\n`);

      return {
        success: true,
        message: `User ${username} created successfully`,
      };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: 'Failed to create user' };
    }
  }

  return { success: false, error: 'Invalid action' };
}
